// Weltereignisse: Missionen gegen ein Ereignis (Missionsziel „event“). Planen mit Abfangpunkt (Schatzschiff) bzw.
// aktuellem Feld (Großflotte, Belagerung), Vorschau und Ankunft. Eingehängt über kleine, markierte Eingriffe in
// commands.ts (launchMission), views.ts (missionPreview) und handlers.ts (missionArrive).
import { and, eq } from "drizzle-orm";
import {
  activeUnits,
  capLoot,
  combineModifiers,
  damageLoot,
  fleetTotals,
  forceHp,
  interceptPoint,
  planMission,
  resolveBattle,
  settle,
  slowestSpeedKmh,
  strandTroops,
  type AttackerInput,
  type Counts,
  type Mission,
  type Modifiers,
  type ResourceMap,
} from "@tidefront/game-core";
import { hexAtLonLat, hexCenter, hexDistanceKm } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type ChangeKind, type NoticeJob } from "./context.ts";
import { activeMissionCount, randomSeed, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import {
  KIND_TEXT, addRes, contributors, endWorldEvent, isOpen, lockWorldEvent, notice, playersWithBase, readWorldEvent, resText, systemMessage,
  type Hex, type WorldEventRow,
} from "./world-events.ts";
import { siegeTick } from "./world-events-run.ts";
import { modifiersFor, modsOf } from "./modifiers.ts";
import { battleWeather, missionWeather, withArrival } from "./weather.ts"; // Wetter wie bei normalen Missionen (v1.6)
import { admiralForLaunch, admiralPreviewMods, assignAdmiral } from "./admirals-core.ts"; // Admirale
import { admiralsAfterBattle, type BattleAdmiral } from "./admirals-battle.ts";

export interface EventMissionInput {
  type: string;
  units: Counts;
  eventId: number;
  /** Admiral, der den Verband führt (Missionsrolle wie bei jedem Überfall). */
  admiralId?: number;
}

/**
 * Zielfeld einer Mission gegen ein Ereignis. Codes: no_event, event_over, event_needs_raid, own_siege (Belagerung des
 * eigenen Hafens, aus diesem Hafen selbst), no_carrier, intercept_impossible.
 */
function aim(ev: WorldEventRow | null, playerId: number, own: BaseRow, input: EventMissionInput, nowMs: number): Hex {
  if (!ev) throw new GameError("no_event");
  if (!isOpen(ev) || nowMs >= ev.endsAt.getTime()) throw new GameError("event_over");
  if (input.type !== "ueberfall") throw new GameError("event_needs_raid");
  // Mehrere Häfen: den Ring um einen eigenen Hafen bricht man nur aus einem anderen eigenen Hafen.
  if (ev.kind === "belagerung" && ev.data.ownerId === playerId && (ev.targetBaseId === null || ev.targetBaseId === own.id)) throw new GameError("own_siege");
  if (ev.kind !== "schatzschiff" || !ev.data.route) return { col: ev.col, row: ev.row };
  const speed = slowestSpeedKmh(input.units, balance);
  if (speed === null) throw new GameError("no_carrier");
  let hit = interceptPoint(ev.data.route, hexCenter(own.col, own.row), speed, nowMs);
  if (!hit) throw new GameError("intercept_impossible");
  // Sturm entlang der Route verlangsamt den Verband: Abfangpunkt mit der Wettergeschwindigkeit nachrechnen (v1.6).
  for (let i = 0; i < 3; i++) {
    const h = hexAtLonLat(hit.point.lon, hit.point.lat);
    const factor = missionWeather(own.col, own.row, h.col, h.row, nowMs)?.shipFactor ?? 1;
    if (factor <= 1.001) break;
    const next = interceptPoint(ev.data.route, hexCenter(own.col, own.row), speed / factor, nowMs);
    if (!next) throw new GameError("intercept_impossible");
    if (Math.abs(next.point.lon - hit.point.lon) < 1e-6 && Math.abs(next.point.lat - hit.point.lat) < 1e-6) break;
    hit = next;
  }
  return hexAtLonLat(hit.point.lon, hit.point.lat);
}

/** Planung wie bei normalen Missionen: Modifikatoren des Spielers und Wetter entlang der Route (Sturm). */
function plan(own: BaseRow, input: EventMissionInput, target: Hex, active: number, nowMs: number, mods: Modifiers) {
  return planMission(
    own.state,
    {
      type: input.type, units: input.units, origin: hexCenter(own.col, own.row), target: hexCenter(target.col, target.row), activeMissions: active,
      weather: missionWeather(own.col, own.row, target.col, target.row, nowMs),
    },
    nowMs,
    balance,
    mods,
  );
}

/** launchMission mit eventId: Verband läuft zum Abfangpunkt bzw. Ereignisfeld aus. */
export async function launchAgainstEvent(
  tx: Tx,
  playerId: number,
  own: BaseRow,
  input: EventMissionInput,
  nowMs: number,
  notify: [number[] | null, ChangeKind][],
): Promise<{ ok: true; missionId: number; arriveAtMs: number } | { ok: false; code: string }> {
  const ev = await readWorldEvent(tx, input.eventId);
  const target = aim(ev, playerId, own, input, nowMs);
  // Admirale: Führer des Verbands (Tempo, Treibstoff, Kampf); prüft Besitz, Hafen und Verfügbarkeit.
  const adm = input.admiralId !== undefined ? await admiralForLaunch(tx, playerId, input.admiralId, nowMs, own.id) : null;
  const r = plan(own, input, target, await activeMissionCount(tx, own.id), nowMs, combineModifiers(await modsOf(tx, own, nowMs), adm?.mods));
  if (!r.ok) return r;
  if (ev!.kind !== "grossflotte" && r.mission.arriveAtMs >= ev!.endsAt.getTime()) return { ok: false, code: "too_late" };
  await saveBase(tx, own.id, r.base);
  const [m] = await tx
    .insert(tables.mission)
    .values({
      playerId, baseId: own.id, type: r.mission.type, targetKind: "event", targetId: ev!.id, targetCol: target.col,
      targetRow: target.row, plan: adm ? { ...r.mission, admiralId: adm.id } : r.mission, status: "outbound", arriveAt: new Date(r.mission.arriveAtMs),
    })
    .returning({ id: tables.mission.id });
  if (adm) await assignAdmiral(tx, adm.id, m.id);
  await scheduleEvent(tx, "mission_arrive", r.mission.arriveAtMs, { missionId: m.id }, null);
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true, missionId: m.id, arriveAtMs: r.mission.arriveAtMs };
}

/** missionPreview mit eventId (ohne Änderung). */
export async function previewAgainstEvent(db: DbOrTx, playerId: number, own: BaseRow, input: EventMissionInput, nowMs: number) {
  const ev = await readWorldEvent(db, input.eventId);
  let target: Hex;
  try {
    target = aim(ev, playerId, own, input, nowMs);
  } catch (err) {
    if (err instanceof GameError) return { ok: false as const, code: err.code, distanceKm: ev ? hexDistanceKm(own, ev) : 0 };
    throw err;
  }
  const distanceKm = hexDistanceKm(own, target);
  const mods = combineModifiers(await modsOf(db, own, nowMs), await admiralPreviewMods(db, playerId, input.admiralId));
  const weather = missionWeather(own.col, own.row, target.col, target.row, nowMs);
  const r = plan({ ...own, state: settle(own.state, nowMs, balance, mods) }, input, target, await activeMissionCount(db, own.id), nowMs, mods);
  if (!r.ok) return { ok: false as const, code: r.code, distanceKm, weather };
  if (ev!.kind !== "grossflotte" && r.mission.arriveAtMs >= ev!.endsAt.getTime()) return { ok: false as const, code: "too_late", distanceKm, weather };
  return {
    ok: true as const,
    distanceKm,
    travelSeconds: r.mission.travelSeconds,
    fuelCost: r.mission.fuelCost,
    arriveAtMs: r.mission.arriveAtMs,
    returnAtMs: r.mission.returnAtMs,
    target: { kind: "event", own: false },
    intercept: target,
    weather: withArrival(weather, target.col, target.row, r.mission.arriveAtMs, nowMs, own.state),
    weatherFactor: r.mission.weather?.shipFactor ?? 1,
  };
}

interface ArriveMission {
  id: number;
  playerId: number | null;
  baseId: number | null;
  targetId: number | null;
  targetCol: number;
  targetRow: number;
}

/** Beitrag eines Spielers fortschreiben. */
async function addDamage(tx: Tx, eventId: number, playerId: number, hp: number, loot: ResourceMap): Promise<void> {
  const where = and(eq(tables.worldEventDamage.eventId, eventId), eq(tables.worldEventDamage.playerId, playerId));
  const [mine] = await tx.select().from(tables.worldEventDamage).where(where).for("update");
  if (!mine) {
    await tx.insert(tables.worldEventDamage).values({ eventId, playerId, hp: Math.round(hp), loot, attacks: 1 });
    return;
  }
  await tx.update(tables.worldEventDamage)
    .set({ hp: mine.hp + Math.round(hp), loot: addRes(mine.loot as ResourceMap, loot), attacks: mine.attacks + 1 })
    .where(where);
}

/**
 * mission_arrive mit targetKind "event": Kampf gegen den Kartellverband auf See, Verluste bleiben am Ereignis.
 * Schatzschiff: nur der erste Sieger erhält die Beute; später Ankommende finden es versenkt. Großflotte und
 * Belagerung: Beute anteilig zum Schaden; ist der Verband vernichtet, endet das Ereignis (Ring gebrochen).
 */
export async function eventMissionArrive(
  tx: Tx,
  m: ArriveMission,
  plan: Mission,
  origin: BaseRow | null,
  due: number,
  attackerName: string,
  admA: BattleAdmiral | null = null,
): Promise<{ returning: Counts; cargoHome: ResourceMap; reportId: number | null; notify: [number[] | null, ChangeKind][]; push: NoticeJob[] }> {
  const notify: [number[] | null, ChangeKind][] = [];
  const push: NoticeJob[] = [];
  const pid = m.playerId!;
  const ev = await lockWorldEvent(tx, m.targetId!);
  const base = { attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, defenderBaseId: null, nestId: null, balanceVersion: balance.version, createdAt: new Date(due) };
  if (!ev || !isOpen(ev) || due >= ev.endsAt.getTime()) {
    const what = ev ? KIND_TEXT[ev.kind] : "Weltereignis";
    const text = !ev ? "Das Ereignis ist vorbei." : ev.kind === "schatzschiff" && ev.outcome === "defeated"
      ? "Das Schatzschiff ist bereits aufgebracht – nur noch Treibgut, der Laderaum ist leer."
      : ev.kind === "schatzschiff" ? "Das Schatzschiff ist entkommen." : `${what}: bei Ankunft schon vorbei.`;
    const [r] = await tx.insert(tables.battleReport).values({
      ...base, kind: "weltereignis_leer", title: `${what}: niemand mehr da`, winner: null, seed: null,
      report: { worldEvent: { id: ev?.id ?? null, kind: ev?.kind ?? null, outcome: ev?.outcome ?? null }, text },
    }).returning({ id: tables.battleReport.id });
    return { returning: { ...plan.units }, cargoHome: {}, reportId: r.id, notify, push };
  }

  // Modifikatoren des Spielers (Forschung, Veteranen) wirken wie bei jedem Überfall.
  const modifiers = combineModifiers(await modifiersFor(tx, pid, { state: origin?.state ?? null, nowMs: due, baseId: origin?.id, isHome: origin?.isHome }), admA?.mods);
  const attacker: AttackerInput = { units: plan.units, versorgungsmangel: origin?.state.versorgungsmangel ?? false, modifiers };
  const seed = randomSeed();
  const res = resolveBattle(attacker, { units: activeUnits(ev.units), defenses: {} }, balance, seed, battleWeather(m.targetCol, m.targetRow, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const { report: raw, destroyed } = strandTroops(res.report, balance);
  const admirals = await admiralsAfterBattle(tx, raw, seed, admA, null, due); // Admirale: Erfahrung, Schicksal
  const before = forceHp(activeUnits(ev.units), balance);
  const left = activeUnits(raw.defender.final);
  const destroyedHp = before - forceHp(left, balance);
  const returning: Counts = activeUnits(raw.attacker.final);
  const cargo = fleetTotals(returning, balance).cargoCapacity;
  const loot = ev.kind === "schatzschiff"
    ? (destroyed ? capLoot(ev.data.loot ?? {}, cargo) : {})
    : damageLoot(ev.data.lootPool ?? {}, ev.data.paid ?? {}, destroyedHp, ev.data.initialHp, cargo);
  const report = { ...raw, loot: { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0, ...loot } };
  if ((report.wreck.stahl ?? 0) + (report.wreck.elektronik ?? 0) > 0) {
    await tx.insert(tables.wreck).values({ col: m.targetCol, row: m.targetRow, stahl: report.wreck.stahl ?? 0, elektronik: report.wreck.elektronik ?? 0, createdAt: new Date(due) });
  }
  const targetName = ev.kind === "belagerung" ? `Belagerungsring vor ${ev.data.baseName ?? "?"}` : KIND_TEXT[ev.kind];
  const title = ev.kind === "schatzschiff" ? (destroyed ? "Schatzschiff aufgebracht" : "Angriff auf das Schatzschiff")
    : ev.kind === "grossflotte" ? (destroyed ? "Großflotte zerschlagen" : "Angriff auf die Großflotte")
    : destroyed ? `Belagerung von ${ev.data.baseName ?? "?"} gebrochen` : `Angriff auf den ${targetName}`;
  const [r] = await tx.insert(tables.battleReport).values({
    ...base, kind: "weltereignis", title, winner: report.winner, seed,
    report: {
      battle: report, attackerName, defenderName: `Kartell (${KIND_TEXT[ev.kind]})`, targetName, attacker, ...(admirals ? { admirals } : {}),
      worldEvent: { id: ev.id, kind: ev.kind, destroyed, destroyedHp, initialHp: ev.data.initialHp, remaining: left },
    },
  }).returning({ id: tables.battleReport.id });
  await addDamage(tx, ev.id, pid, destroyedHp, loot);
  const data = { ...ev.data, paid: ev.kind === "schatzschiff" ? ev.data.paid : addRes(ev.data.paid ?? {}, loot) };
  await tx.update(tables.worldEvent).set({ units: left, data }).where(eq(tables.worldEvent.id, ev.id));
  ev.data = data;

  if (destroyed) {
    notify.push([null, "map"], [null, "messages"]);
    if (ev.kind === "belagerung") {
      await siegeTick(tx, ev, due);
      await endWorldEvent(tx, ev, "defeated", due, pid, { endsAt: new Date(due) });
      const ids = [ev.data.ownerId!, ...(await contributors(tx, ev.id))];
      await systemMessage(tx, ids, `Belagerung von ${ev.data.baseName} gebrochen`, `${attackerName} hat den Belagerungsring vor ${ev.data.baseName} gebrochen. Börse und Produktion sind wieder frei.`, due);
      push.push(notice(ev.data.ownerId!, "attack", "Belagerung gebrochen", `${attackerName} hat den Ring um ${ev.data.baseName} gebrochen.`));
      notify.push([[ev.data.ownerId!], "base"]);
    } else if (ev.kind === "schatzschiff") {
      await endWorldEvent(tx, ev, "defeated", due, pid, { col: m.targetCol, row: m.targetRow, endsAt: new Date(due) });
      const ids = (await playersWithBase(tx)).map((p) => p.playerId);
      await systemMessage(tx, ids, "Schatzschiff aufgebracht", `${attackerName} hat das Schatzschiff aufgebracht und ${resText(loot)} erbeutet.`, due);
    } else {
      await endWorldEvent(tx, ev, "defeated", due, pid, { endsAt: new Date(due) });
      const ids = [...(ev.data.targets ?? []).map((t) => t.playerId), ...(await contributors(tx, ev.id))];
      await systemMessage(tx, ids, "Großflotte zerschlagen", `${attackerName} hat der Großflotte den letzten Schlag versetzt. Die angekündigten Angriffe entfallen.`, due);
    }
  } else {
    notify.push([null, "map"]);
  }
  push.push(notice(pid, "report", `Kampfbericht: ${title}`, sumLoot(loot) > 0 ? `Beute: ${resText(loot)}.` : "Keine Beute.", r.id));
  return { returning, cargoHome: loot, reportId: r.id, notify, push };
}

function sumLoot(m: ResourceMap): number {
  return Object.values(m).reduce((a, b) => a + b, 0);
}
