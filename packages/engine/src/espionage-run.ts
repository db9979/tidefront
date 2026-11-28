// Spionage: Ankunft (spy_arrive) mit offenem W20 aus dem gespeicherten Seed, Wirkung je Auftragsart, Berichte (kind
// „spionage“ für den Absender bzw. bei Enttarnung für beide, „sabotage“ für das Opfer ohne Absender), Systemnachricht
// und Push bei Enttarnung sowie das Ende einer Sabotage (spy_sabotage_end). Rückkehr der Spione über mission_return.
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  addDisinfo,
  applySabotage,
  clearSabotage,
  espionageOf,
  intelLevel,
  loseSpies,
  protectionStatus,
  recordSpySuccess,
  resolveSpy,
  routePosition,
  sabotageCooldownUntil,
  scoutBase,
  settle,
  spyDefenseValue,
  spySuccessValue,
  trainingLeft,
  worldEventsBalance,
  type Counts,
  type SpyMission,
} from "@tidefront/game-core";
import { hexAtLonLat } from "@tidefront/world";
import { tables, type Tx } from "@tidefront/db";
import { balance, type NoticeJob } from "./context.ts";
import type { Handler, HandlerResult } from "./events.ts";
import { lockBase, lockBases, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { diplomacyBlock } from "./alliance-core.ts";
import { veteranView } from "./veterans.ts";
import { TECH_NAMES } from "./research.ts";
import { scoutWithDisinfo } from "./espionage.ts";
import { trackProgress } from "./challenges.ts";
import { KIND_TEXT, openWorldEvents, systemMessage } from "./world-events.ts";
import { clock } from "./names.ts";
import { recordReportIntel } from "./intel-store.ts"; // Lagebild Stufe 2: Dossier als Lagebild

const HOUR_MS = 3600000;

/** Namen der Sabotageziele für Berichte und Nachrichten. */
export const SABOTAGE_TEXT: Record<string, string> = {
  kraftwerk: "Kraftwerk", radarstation: "Radarstation", werft: "Werft", kaserne: "Kaserne", flugfeld: "Flugfeld",
  forschungsamt: "Forschungsamt", bauschlange: "Bauschlange", seekabel: "Seekabel",
};
const KIND_TITLE: Record<string, string> = { erkunden: "Erkunden", sabotage: "Sabotage", desinformation: "Desinformation", kartell: "Kartell-Aufklärung" };

async function nameOf(tx: Tx, id: number | null): Promise<string> {
  if (id === null) return "?";
  const [p] = await tx.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, id));
  return p?.name ?? "?";
}

async function insertReport(tx: Tx, v: {
  kind: string; title: string; attackerPlayerId: number | null; defenderPlayerId: number | null; attackerBaseId: number | null;
  defenderBaseId: number | null; winner: string | null; seed: number | null; report: unknown; atMs: number;
}): Promise<number> {
  const [r] = await tx.insert(tables.battleReport)
    .values({ ...v, nestId: null, balanceVersion: balance.version, createdAt: new Date(v.atMs) })
    .returning({ id: tables.battleReport.id });
  return r.id;
}

/** Erkunden: Lagebild wie Aufklärung (mit Desinformation), dazu Forschung, Bauschlange, Ausbildung, Veteranen, ggf. Missionen. */
async function scoutDossier(tx: Tx, target: BaseRow, viewer: number, senderLevel: number, due: number) {
  const mods = await modsOf(tx, target, due);
  const s = settle(target.state, due, balance, mods);
  const { scout, falsified } = await scoutWithDisinfo(tx, target, viewer, scoutBase(target.state, due, balance, mods), due);
  const research = s.research ? { levels: s.research.levels, order: s.research.order ? { techId: s.research.order.techId, name: TECH_NAMES[s.research.order.techId] ?? s.research.order.techId, targetLevel: s.research.order.targetLevel, finishesAt: s.research.order.finishesAt } : null } : null;
  let missions: unknown[] | null = null;
  if (senderLevel >= espionageOf(balance)!.missionsFromLevel) {
    const rows = await tx.select().from(tables.mission)
      .where(and(eq(tables.mission.baseId, target.id), inArray(tables.mission.status, ["outbound", "returning"])))
      .orderBy(asc(tables.mission.arriveAt));
    missions = rows.map((m) => ({
      type: m.type, status: m.status, target: { kind: m.targetKind, col: m.targetCol, row: m.targetRow },
      units: (m.plan as { units?: Counts }).units ?? {}, arriveAtMs: m.arriveAt.getTime(), returnAtMs: m.returnAt?.getTime() ?? null,
    }));
  }
  return {
    scout, falsified,
    research,
    buildQueue: s.buildQueue.map((o) => ({ buildingId: o.buildingId, targetLevel: o.targetLevel, finishesAt: o.finishesAt })),
    trainingQueue: s.trainingQueue.map((o) => ({ id: o.id, count: trainingLeft(o), finishesAt: o.finishesAt })), // Teillieferung: nur der Rest
    veterans: veteranView(s).filter((v) => v.xp > 0).map((v) => ({ id: v.id, rankName: v.rankName, xp: v.xp })),
    missions,
  };
}

/** Kartell-Aufklärung: nächstes Ereignis (Art, Zeitpunkt), offene Ereignisse mit Route, Zielhäfen und Zeitplan. */
async function cartelDossier(tx: Tx, due: number) {
  const [next] = await tx.select().from(tables.gameEvent)
    .where(and(eq(tables.gameEvent.type, "world_event_spawn"), eq(tables.gameEvent.status, "pending")))
    .orderBy(asc(tables.gameEvent.dueAt)).limit(1);
  const attacks = await tx.select().from(tables.gameEvent)
    .where(and(eq(tables.gameEvent.type, "world_event_attack"), eq(tables.gameEvent.status, "pending")));
  const events = (await openWorldEvents(tx)).map((e) => {
    const route = e.data.route ?? [];
    const ahead = route.filter((p) => p.atMs >= due).slice(0, 8).map((p) => ({ ...hexAtLonLat(p.lon, p.lat), atMs: p.atMs }));
    const pos = route.length > 0 ? routePosition(route, due) : null;
    const now = pos ? hexAtLonLat(pos.lon, pos.lat) : { col: e.col, row: e.row };
    const nextAttack = attacks.filter((a) => Number((a.payload as { eventId?: number }).eventId) === e.id).map((a) => a.dueAt.getTime()).sort((a, b) => a - b)[0] ?? null;
    const step = worldEventsBalance(balance).grossflotte.attackIntervalHours;
    const pending = (e.data.targets ?? []).filter((t) => t.status === "pending");
    return {
      id: e.id, kind: e.kind, name: KIND_TEXT[e.kind], status: e.status, position: now,
      activeAtMs: e.activeAt.getTime(), endsAtMs: e.endsAt.getTime(), units: e.units,
      harbor: e.data.harbor ?? null, route: ahead,
      // Großflotte: Zielhäfen in Reihenfolge mit erwarteter Angriffszeit (nächster Angriff + Abstand).
      targets: pending.map((t, i) => ({ name: t.name, col: t.col, row: t.row, atMs: nextAttack !== null ? nextAttack + i * step * HOUR_MS : null })),
      siege: e.kind === "belagerung" ? { baseName: e.data.baseName ?? "?", lootLeft: e.data.lootPool ?? {} } : null,
    };
  });
  return { next: next ? { atMs: next.dueAt.getTime(), kind: String((next.payload as { kind?: string }).kind ?? "") || null } : null, events };
}

interface MissionRow {
  id: number; playerId: number | null; baseId: number | null; targetKind: string; targetId: number | null; plan: unknown; status: string;
}

/** Ankunft eines Spionageauftrags. */
export const spyArrive: Handler = async (tx, ev, due) => {
  const [row] = await tx.select().from(tables.mission).where(eq(tables.mission.id, Number(ev.payload.missionId))).for("update");
  const m = row as MissionRow | undefined;
  if (!m || m.status !== "outbound" || m.playerId === null || m.baseId === null) return { notify: [] };
  const plan = m.plan as SpyMission;
  const spy = plan.spy;
  const pid = m.playerId;
  const bases = await lockBases(tx, m.targetId !== null && m.targetKind === "base" ? [m.baseId, m.targetId] : [m.baseId]);
  const origin = bases.get(m.baseId);
  const target = m.targetKind === "base" && m.targetId !== null ? bases.get(m.targetId) ?? null : null;
  const notify: HandlerResult["notify"] = [[[pid], "missions"], [[pid], "reports"], [[pid], "base"]];
  const push: NoticeJob[] = [];
  const senderName = await nameOf(tx, pid);
  const ownerName = target ? await nameOf(tx, target.playerId) : "Freibeuter-Kartell";
  const targetName = target ? target.name : "Freibeuter-Kartell";
  const back = async (reportId: number | null, success: boolean) => {
    if (origin && success) await saveBase(tx, origin.id, recordSpySuccess(origin.state));
    await tx.update(tables.mission)
      .set({ status: "returning", returning: { ...plan.units }, cargoHome: {}, reportId, returnAt: new Date(plan.returnAtMs) })
      .where(eq(tables.mission.id, m.id));
    await scheduleEvent(tx, "mission_return", plan.returnAtMs, { missionId: m.id }, m.baseId);
  };
  const common = { kind: spy.kind, building: spy.building ?? null, spies: spy.spies, targetName, owner: ownerName, from: senderName };

  // Abbruch ohne Wurf: Ziel verschwunden, inzwischen verbündet oder die Sabotage-Sperrfrist läuft.
  let abort: string | null = null;
  if (m.targetKind === "base" && !target) abort = "Das Ziel gibt es nicht mehr.";
  else if (target && protectionStatus(target.state.protection, due, balance).reason === "anfaengerschutz") abort = "Das Ziel steht unter Anfängerschutz.";
  else if (target && spy.kind === "sabotage" && (await diplomacyBlock(tx, pid, target.playerId, due))) abort = "Ihr seid inzwischen verbündet oder durch einen Pakt gebunden – der Spion bricht ab.";
  else if (target && spy.kind === "sabotage" && sabotageCooldownUntil(target.state, balance) > due) abort = "Das Ziel ist nach einer Sabotage noch in Alarmbereitschaft – kein Zugriff.";
  if (abort) {
    const reportId = await insertReport(tx, {
      kind: "spionage", title: `${KIND_TITLE[spy.kind]}: ${targetName} – abgebrochen`, attackerPlayerId: pid, defenderPlayerId: null,
      attackerBaseId: m.baseId, defenderBaseId: target?.id ?? null, winner: null, seed: spy.seed, atMs: due,
      report: { spy: { ...common, aborted: abort } },
    });
    await back(reportId, false);
    return { notify };
  }

  const ownMods = origin ? await modsOf(tx, origin, due) : {};
  const targetMods = target ? await modsOf(tx, target, due) : undefined;
  const success = spySuccessValue(origin?.state ?? ({ buildings: {}, units: {}, unitsAway: {}, trainingQueue: [] } as never), spy.kind, balance, ownMods);
  const defense = spyDefenseValue(target?.state ?? null, spy.kind, balance, targetMods);
  const roll = resolveSpy(spy.seed, success.total, defense.total, espionageOf(balance)!.die);
  const dice = { ...common, roll: roll.roll, die: roll.die, threshold: roll.threshold, success: roll.success, successValue: success, defenseValue: defense, chanceAtLaunch: spy.chance };

  if (!roll.success) {
    // Enttarnt: Spione verloren, Ziel erfährt den Absender, Bericht für beide (mit Verlusten für Bilanz und Wertung).
    if (origin) await saveBase(tx, origin.id, loseSpies(origin.state, spy.spies, due, balance, ownMods));
    const lost = { ...plan.units };
    const battle = {
      winner: "defender", phases: [],
      attacker: { before: lost, survivors: {}, losses: lost, returned: {}, final: {} },
      defender: { before: {}, survivors: {}, losses: {}, returned: {}, final: {} },
      loot: {}, wreck: {},
    };
    const reportId = await insertReport(tx, {
      kind: "spionage", title: `Spion enttarnt: ${KIND_TITLE[spy.kind]} gegen ${targetName}`, attackerPlayerId: pid,
      defenderPlayerId: target?.playerId ?? null, attackerBaseId: m.baseId, defenderBaseId: target?.id ?? null,
      winner: "defender", seed: spy.seed, atMs: due, report: { spy: dice, battle },
    });
    await tx.update(tables.mission).set({ status: "done", returning: {}, cargoHome: {}, reportId }).where(eq(tables.mission.id, m.id));
    push.push({ playerId: pid, notice: { kind: "report", url: "/?tab=meldungen", tag: `spy-${m.id}`, reportId, title: "Spion enttarnt", body: `Dein Spion wurde in ${targetName} enttarnt (Wurf ${roll.roll}, nötig ≤ ${roll.threshold}). Er ist verloren.` } });
    if (target) {
      const what = KIND_TITLE[spy.kind] + (spy.building ? ` (${SABOTAGE_TEXT[spy.building] ?? spy.building})` : "");
      await systemMessage(tx, [target.playerId], `Fremder Spion enttarnt – Absender ${senderName}`,
        `In ${target.name} wurde ein Spion von ${senderName} enttarnt. Auftrag: ${what}. Der Spion ist ausgeschaltet; der Wurf steht im Bericht.`, due);
      push.push({ playerId: target.playerId, notice: { kind: "attack", url: "/?tab=meldungen", tag: `spy-def-${m.id}`, reportId, title: "Fremder Spion enttarnt", body: `Absender: ${senderName}. Auftrag: ${what}.` } });
      notify.push([[target.playerId], "reports"], [[target.playerId], "messages"]);
    }
    return { notify, push };
  }

  // Erfolg: Ziel merkt nichts (bei Sabotage nur die Folgen ohne Absender).
  let detail: Record<string, unknown> = {};
  if (spy.kind === "erkunden" && target) {
    detail = { dossier: await scoutDossier(tx, target, pid, intelLevel(origin?.state, balance), due) };
  } else if (spy.kind === "sabotage" && target && spy.building) {
    const r = applySabotage(target.state, spy.building, due, balance, targetMods);
    if (r.ok) {
      await saveBase(tx, target.id, r.base);
      for (const at of r.training) await scheduleEvent(tx, "training_complete", at, {}, target.id);
      if (r.research !== null) await scheduleEvent(tx, "research_complete", r.research, {}, target.id);
      for (const at of r.build) await scheduleEvent(tx, "build_complete", at, {}, target.id);
      await scheduleEvent(tx, "spy_sabotage_end", r.sabotage.untilMs, {}, target.id);
      const name = SABOTAGE_TEXT[spy.building] ?? spy.building;
      const effect = spy.building === "bauschlange" ? `Der Ausbau verzögert sich um ${espionageOf(balance)!.sabotage.delayHours} Stunden.` : `${name} fällt aus bis ${clock(r.sabotage.untilMs)} Uhr.`;
      detail = { sabotage: { ...r.sabotage, effect } };
      const sabotageReportId = await insertReport(tx, {
        kind: "sabotage", title: `Sabotage in ${target.name}: ${name}`, attackerPlayerId: null, defenderPlayerId: target.playerId,
        attackerBaseId: null, defenderBaseId: target.id, winner: null, seed: null, atMs: due,
        report: { sabotage: { ...r.sabotage, effect }, targetName: target.name },
      });
      push.push({ playerId: target.playerId, notice: { kind: "attack", url: "/?tab=basis", tag: `sabotage-${target.id}`, reportId: sabotageReportId, title: `Sabotage: ${name}`, body: effect } });
      notify.push([[target.playerId], "base"], [[target.playerId], "reports"]);
    }
  } else if (spy.kind === "desinformation" && target && origin) {
    const until = due + espionageOf(balance)!.disinfo.hours * HOUR_MS;
    // Desinformation liegt beim Absender: das Ziel sieht im nächsten Lagebild über ihn falsche Zahlen.
    origin.state = addDisinfo(origin.state, target.playerId, until);
    await saveBase(tx, origin.id, origin.state);
    detail = { disinfo: { untilMs: until, forceFactor: espionageOf(balance)!.disinfo.forceFactor, resourceFactor: espionageOf(balance)!.disinfo.resourceFactor } };
  } else if (spy.kind === "kartell") {
    detail = { cartel: await cartelDossier(tx, due) };
  }
  const reportId = await insertReport(tx, {
    kind: "spionage", title: `${KIND_TITLE[spy.kind]}: ${targetName}`, attackerPlayerId: pid, defenderPlayerId: null,
    attackerBaseId: m.baseId, defenderBaseId: target?.id ?? null, winner: "attacker", seed: spy.seed, atMs: due,
    report: { spy: dice, ...detail },
  });
  // Lagebild Stufe 2: ein Erkundungs-Dossier zählt als Lagebild des Hafens.
  if (spy.kind === "erkunden" && target) await recordReportIntel(tx, { kind: "spionage", attackerPlayerId: pid, defenderBaseId: target.id, nestId: null, report: detail, atMs: due });
  await back(reportId, true);
  // Tagesbefehl „erkundung“: erfolgreiche Erkundung (Hafen oder Kartell).
  if (spy.kind === "erkunden" || spy.kind === "kartell") await trackProgress(tx, pid, "erkundung", 1, { atMs: due });
  push.push({ playerId: pid, notice: { kind: "report", url: "/?tab=meldungen", tag: `spy-${m.id}`, reportId, title: `Spionagebericht: ${KIND_TITLE[spy.kind]}`, body: `Auftrag gegen ${targetName} gelungen (Wurf ${roll.roll}, nötig ≤ ${roll.threshold}).` } });
  return { notify, push };
};

/** Ende einer Sabotage: Bestände mit der Sabotage-Wirkung bis zum Ende fortschreiben, dann aufheben. */
export const spySabotageEnd: Handler = async (tx, ev, due) => {
  const b = await lockBase(tx, ev.baseId!);
  const s = b?.state.intel?.sabotage;
  if (!b || !s || s.untilMs > due) return { notify: [] };
  const mods = await modsOf(tx, b, s.untilMs - 1);
  await saveBase(tx, b.id, clearSabotage(settle(b.state, due, balance, mods), due));
  return { notify: [[[b.playerId], "base"]] };
};
