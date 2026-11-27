// Allianz-Ops: Ankunft eines Sammelangriffs (Ereignis alliance_raid_arrive). Alle noch anfliegenden Verbände bilden
// eine gemeinsame Streitmacht in einem einzigen resolveBattle (Modifikatoren je Teilnehmer gemittelt, combineForces);
// Verluste und Überlebende werden nach Besitzer zurückgerechnet (splitOutcome), die Beute nach Kampfbeitrag geteilt
// (shareLoot). Ein gemeinsamer Bericht für alle Teilnehmer und das Ziel.
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import {
  activeUnits,
  applyDefenseResult,
  baseStrength,
  combatValue,
  combineForces,
  damageLoot,
  defenderFromBase,
  fleetTotals,
  forceHp,
  isNestRespawned,
  isWeakTarget,
  liveNestDefender,
  resolveBattle,
  settle,
  sharePercents,
  shareLoot,
  splitOutcome,
  settleBattle, victoryRuleOf, // Sieger nach Kampfart (wie der Simulator)
  type BattleReport,
  type DefenderInput,
  type Mission,
  type Modifiers,
  type ResourceMap,
} from "@tidefront/game-core";
import { nestConquered, nestDefended, nestState } from "./nest-live.ts"; // Lebendige Nester
import { tables, type Tx } from "@tidefront/db";
import { balance, type NoticeJob } from "./context.ts";
import type { Handler, HandlerResult } from "./events.ts";
import { lockBase, randomSeed, readBase, saveBase, scheduleEvent } from "./store.ts";
import { modifiersFor, modsOf } from "./modifiers.ts";
import { battleWeather } from "./weather.ts";
import { atWar, memberIds, type Notes } from "./alliance-core.ts";
import { dropWreck, salvageAt, storeReport } from "./handlers.ts";
import { settleGuests, stationedGuests, withGuests } from "./alliance-ops-station.ts";
import { lockRaid } from "./alliance-ops-raid.ts";
import { KIND_TEXT, addRes, contributors, endWorldEvent, isOpen, lockWorldEvent, resText, systemMessage } from "./world-events.ts";
import { siegeTick } from "./world-events-run.ts";
import { finaleRaidFight } from "./finale-battle.ts"; // Saisonfinale

const HOUR_MS = 3600000;

export interface Part {
  playerId: number;
  name: string;
  mission: typeof tables.mission.$inferSelect;
  plan: Mission;
  mods: Modifiers;
  shortage: boolean;
  value: number;
}

export interface Fight {
  kind: string;
  title: string;
  defenderPlayerId: number | null;
  defenderBaseId: number | null;
  nestId: number | null;
  defenderName: string;
  report: BattleReport | null;
  /** Beute vor der Teilung (ohne Laderaumgrenze). */
  loot: ResourceMap;
  extra: Record<string, unknown>;
  /** Saisonfinale: Beute ohne Laderaumgrenze teilen. */
  uncapped?: boolean;
  /** Nach der Teilung: Beute insgesamt verbuchen (Verteidiger, Ereignis). */
  commit?: (total: ResourceMap, shares: ResourceMap[]) => Promise<void>;
}

const sum = (m: ResourceMap) => Object.values(m).reduce((a, b) => a + b, 0);

/** Kampf gegen einen Spielerhafen (mit stationierten Verbündeten des Ziels). */
async function fightBase(tx: Tx, parts: Part[], joint: ReturnType<typeof combineForces>, targetId: number, due: number, notify: HandlerResult["notify"]): Promise<Fight | null> {
  const target = await lockBase(tx, targetId);
  if (!target) return null;
  const targetMods = await modsOf(tx, target, due);
  const defenderBase = settle(target.state, due, balance, targetMods);
  const ids = parts.map((p) => p.playerId);
  const [prior] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tables.battleReport)
    .where(and(
      inArray(tables.battleReport.kind, ["ueberfall", "sammelangriff"]),
      inArray(tables.battleReport.attackerPlayerId, ids),
      eq(tables.battleReport.defenderBaseId, target.id),
      gt(tables.battleReport.createdAt, new Date(due - balance.loot.repeatWindowHours * HOUR_MS)),
    ));
  let weak = false;
  for (const p of parts) {
    const origin = p.mission.baseId ? await readBase(tx, p.mission.baseId) : null;
    if (origin && isWeakTarget(baseStrength(origin.state), baseStrength(defenderBase), balance) && !(await atWar(tx, p.playerId, target.playerId, due))) weak = true;
  }
  const attacker = { ...joint, priorAttacksInWindow: prior?.n ?? 0, weakTarget: weak };
  const defender: DefenderInput = defenderFromBase(defenderBase, balance, targetMods);
  const guests = await stationedGuests(tx, target.id); // stationierte Verbündete verteidigen mit
  const seed = randomSeed();
  const res = resolveBattle(attacker, withGuests(defender, guests), balance, seed, battleWeather(target.col, target.row, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const [owner] = await tx.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, target.playerId));
  notify.push([[target.playerId], "base"], [[target.playerId], "reports"], [[target.playerId], "missions"]);
  const extra: Record<string, unknown> = { protectedPerResource: defender.protectedPerResource ?? 0, seed };
  return {
    kind: "sammelangriff", title: `Sammelangriff auf ${target.name}`, defenderPlayerId: target.playerId, defenderBaseId: target.id, nestId: null,
    defenderName: owner?.name ?? "?", report: res.report, loot: res.report.loot, extra,
    commit: async (total) => {
      const report = { ...res.report, loot: total };
      const hostReport = await settleGuests(tx, guests, defender, report, due, notify);
      await saveBase(tx, target.id, applyDefenseResult(defenderBase, hostReport, due, balance, targetMods));
      if (hostReport.guests) extra.guests = hostReport.guests; // Verluste der stationierten Verbündeten
    },
  };
}

/** Kampf gegen ein Piratennest; verlassen: kein Kampf. */
async function fightNest(tx: Tx, joint: ReturnType<typeof combineForces>, nestId: number, due: number, notify: HandlerResult["notify"]): Promise<Fight> {
  const [nest] = await tx.select().from(tables.nest).where(eq(tables.nest.id, nestId)).for("update");
  const name = `Piratennest Stufe ${nest.level}`;
  const base = { defenderPlayerId: null, defenderBaseId: null, nestId: nest.id, defenderName: "Freibeuter-Kartell" };
  if (nest.defeatedAt !== null && !isNestRespawned(nest.defeatedAt.getTime(), due, balance, nest.level)) {
    return { ...base, kind: "leer", title: `${name} ist verlassen`, report: null, loot: {}, extra: { nestLevel: nest.level } };
  }
  // Lebendige Nester: Kampf gegen die aktuelle Besatzung; Eroberung bzw. Schwächung wie beim Einzelüberfall.
  const defender = liveNestDefender(nest.level, nestState(nest), due, balance);
  const seed = randomSeed();
  const res = resolveBattle(joint, defender, balance, seed, battleWeather(nest.col, nest.row, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  if (res.report.winner === "attacker") {
    await nestConquered(tx, nest, due);
    notify.push([null, "map"]);
  } else await nestDefended(tx, nest, res.report.defender.final, due);
  return { ...base, kind: "sammelangriff", title: `Sammelangriff auf ${name}`, report: res.report, loot: res.report.loot, extra: { seed } };
}

/** Kampf gegen Großflotte oder Belagerungsring: der Sammelangriff zählt als ein Sieger. */
async function fightEvent(tx: Tx, parts: Part[], joint: ReturnType<typeof combineForces>, eventId: number, col: number, row: number, label: string, due: number, notify: HandlerResult["notify"], push: NoticeJob[]): Promise<Fight> {
  const ev = await lockWorldEvent(tx, eventId);
  const base = { defenderPlayerId: null, defenderBaseId: null, nestId: null, defenderName: "Kartell" };
  if (!ev || !isOpen(ev) || due >= ev.endsAt.getTime()) {
    return { ...base, kind: "weltereignis_leer", title: `${ev ? KIND_TEXT[ev.kind] : "Weltereignis"}: niemand mehr da`, report: null, loot: {},
      extra: { worldEvent: { id: ev?.id ?? null, kind: ev?.kind ?? null, outcome: ev?.outcome ?? null }, text: "Das Ereignis war bei Ankunft schon vorbei." } };
  }
  if (ev.kind === "finale") return finaleRaidFight(tx, parts, joint, ev, col, row, due, notify, push); // Saisonfinale: Abschnitt, Schatz
  const seed = randomSeed();
  const res = resolveBattle(joint, { units: activeUnits(ev.units), defenses: {} }, balance, seed, battleWeather(col, row, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const { report: raw, destroyed } = settleBattle(res.report, balance, victoryRuleOf("weltereignis"));
  const left = activeUnits(raw.defender.final);
  const destroyedHp = forceHp(activeUnits(ev.units), balance) - forceHp(left, balance);
  const loot = damageLoot(ev.data.lootPool ?? {}, ev.data.paid ?? {}, destroyedHp, ev.data.initialHp, Number.MAX_SAFE_INTEGER);
  const title = ev.kind === "grossflotte" ? (destroyed ? "Großflotte zerschlagen (Sammelangriff)" : "Sammelangriff auf die Großflotte")
    : destroyed ? `Belagerung von ${ev.data.baseName ?? "?"} gebrochen (Sammelangriff)` : `Sammelangriff auf den ${label}`;
  return {
    ...base, kind: "weltereignis", title, defenderName: `Kartell (${KIND_TEXT[ev.kind]})`, report: raw, loot,
    extra: { seed, worldEvent: { id: ev.id, kind: ev.kind, destroyed, destroyedHp, initialHp: ev.data.initialHp, remaining: left } },
    commit: async (total, shares) => {
      // Beitrag je Teilnehmer: Schaden und Beute anteilig (für die Ereigniswertung).
      const w = parts.map((p) => p.value);
      const W = w.reduce((a, b) => a + b, 0) || 1;
      for (let i = 0; i < parts.length; i++) {
        const where = and(eq(tables.worldEventDamage.eventId, ev.id), eq(tables.worldEventDamage.playerId, parts[i].playerId));
        const hp = Math.round((destroyedHp * w[i]) / W);
        const [mine] = await tx.select().from(tables.worldEventDamage).where(where).for("update");
        if (!mine) await tx.insert(tables.worldEventDamage).values({ eventId: ev.id, playerId: parts[i].playerId, hp, loot: shares[i], attacks: 1 });
        else await tx.update(tables.worldEventDamage).set({ hp: mine.hp + hp, loot: addRes(mine.loot as ResourceMap, shares[i]), attacks: mine.attacks + 1 }).where(where);
      }
      const data = { ...ev.data, paid: addRes(ev.data.paid ?? {}, total) };
      await tx.update(tables.worldEvent).set({ units: left, data }).where(eq(tables.worldEvent.id, ev.id));
      ev.data = data;
      notify.push([null, "map"]);
      if (!destroyed) return;
      notify.push([null, "messages"]);
      const names = parts.map((p) => p.name).join(", ");
      if (ev.kind === "belagerung") {
        await siegeTick(tx, ev, due);
        await endWorldEvent(tx, ev, "defeated", due, parts[0].playerId, { endsAt: new Date(due) });
        await systemMessage(tx, [ev.data.ownerId!, ...(await contributors(tx, ev.id))], `Belagerung von ${ev.data.baseName} gebrochen`, `Ein Sammelangriff (${names}) hat den Belagerungsring vor ${ev.data.baseName} gebrochen. Börse und Produktion sind wieder frei.`, due);
        push.push({ playerId: ev.data.ownerId!, notice: { kind: "attack", title: "Belagerung gebrochen", body: `Ein Sammelangriff hat den Ring um ${ev.data.baseName} gebrochen.`, url: "/?tab=karte", tag: "weltereignis-attack" } });
        notify.push([[ev.data.ownerId!], "base"]);
      } else {
        await endWorldEvent(tx, ev, "defeated", due, parts[0].playerId, { endsAt: new Date(due) });
        const ids = [...(ev.data.targets ?? []).map((t) => t.playerId), ...(await contributors(tx, ev.id))];
        await systemMessage(tx, ids, "Großflotte zerschlagen", `Ein Sammelangriff (${names}) hat der Großflotte den letzten Schlag versetzt. Die angekündigten Angriffe entfallen.`, due);
      }
    },
  };
}

/** Ereignis alliance_raid_arrive. */
export const raidArrive: Handler = async (tx, ev, due) => {
  const raid = await lockRaid(tx, Number(ev.payload.raidId));
  if (!raid || raid.status !== "ausgelaufen") return { notify: [] };
  const notify: HandlerResult["notify"] = [];
  const push: NoticeJob[] = [];
  const rows = await tx
    .select({ mission: tables.mission, name: tables.player.name })
    .from(tables.allianceRaidMember)
    .innerJoin(tables.mission, eq(tables.mission.id, tables.allianceRaidMember.missionId))
    .innerJoin(tables.player, eq(tables.player.id, tables.allianceRaidMember.playerId))
    .where(and(eq(tables.allianceRaidMember.raidId, raid.id), eq(tables.mission.status, "outbound")))
    .orderBy(tables.mission.id)
    .for("update", { of: tables.mission });
  if (rows.length === 0) {
    await tx.update(tables.allianceRaid).set({ status: "beendet" }).where(eq(tables.allianceRaid.id, raid.id));
    return { notify };
  }
  const parts: Part[] = [];
  for (const r of rows) {
    const origin = r.mission.baseId ? await readBase(tx, r.mission.baseId) : null;
    const plan = r.mission.plan as Mission;
    const mods = await modifiersFor(tx, r.mission.playerId!, { state: origin?.state ?? null, nowMs: due, baseId: origin?.id, isHome: origin?.isHome });
    parts.push({ playerId: r.mission.playerId!, name: r.name, mission: r.mission, plan, mods, shortage: origin?.state.versorgungsmangel ?? false, value: combatValue(plan.units, balance, mods) });
  }
  const joint = combineForces(parts.map((p) => ({ units: p.plan.units, modifiers: p.mods, versorgungsmangel: p.shortage })), balance);
  const fight = raid.targetKind === "base" ? await fightBase(tx, parts, joint, raid.targetId, due, notify)
    : raid.targetKind === "nest" ? await fightNest(tx, joint, raid.targetId, due, notify)
    : await fightEvent(tx, parts, joint, raid.targetId, raid.targetCol, raid.targetRow, raid.targetName, due, notify, push);

  // Aufteilung nach Besitzern; ohne Kampf kehrt jeder mit seinem Verband heim.
  const owners = parts.map((p) => p.plan.units);
  const split = fight?.report ? splitOutcome(fight.report.attacker, owners) : null;
  const finals = parts.map((p, i) => (split ? activeUnits(split[i].final) : { ...p.plan.units }));
  const caps = parts.map((p, i) => fleetTotals(finals[i], balance, p.mods).cargoCapacity);
  const weights = parts.map((p) => p.value);
  const shares = fight?.report ? shareLoot(fight.loot, weights, fight.uncapped ? caps.map(() => Number.MAX_SAFE_INTEGER) : caps, balance.resources) : parts.map(() => ({}) as ResourceMap);
  const total: ResourceMap = {};
  for (const r of balance.resources) total[r] = shares.reduce((s, x) => s + (x[r] ?? 0), 0);
  if (fight?.commit) await fight.commit(total, shares);
  if (fight?.report) await dropWreck(tx, raid.targetCol, raid.targetRow, fight.report.wreck, due);
  const pct = sharePercents(weights);

  let reportId: number | null = null;
  if (fight) {
    const tag = (await tx.select({ tag: tables.alliance.tag }).from(tables.alliance).where(eq(tables.alliance.id, raid.allianceId)))[0]?.tag ?? "?";
    const battle = fight.report ? { ...fight.report, loot: total } : undefined;
    reportId = await storeReport(tx, {
      kind: fight.kind, title: fight.title, attackerPlayerId: parts[0].playerId, defenderPlayerId: fight.defenderPlayerId,
      attackerBaseId: parts[0].mission.baseId, defenderBaseId: fight.defenderBaseId, nestId: fight.nestId,
      winner: fight.report?.winner ?? null, seed: (fight.extra.seed as number | undefined) ?? null, atMs: due,
      report: {
        ...fight.extra, ...(battle ? { battle, attacker: joint } : {}),
        attackerName: `Sammelangriff [${tag}]`, defenderName: fight.defenderName, targetName: raid.targetName,
        allianceRaid: {
          raidId: raid.id, tag,
          participants: parts.map((p, i) => ({
            playerId: p.playerId, name: p.name, value: Math.round(p.value), share: pct[i], cargo: Math.floor(caps[i]), loot: shares[i],
            ...(split ? { outcome: split[i] } : { outcome: { before: p.plan.units, survivors: p.plan.units, losses: {}, returned: {}, final: p.plan.units } }),
          })),
        },
      },
    });
  }

  // Heimfahrt je Teilnehmer: Endbestand, Beuteanteil, Wrackgut mit dem freien Laderaum.
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let cargo: ResourceMap = { ...shares[i] };
    const salvage = await salvageAt(tx, raid.targetCol, raid.targetRow, caps[i] - sum(cargo), due);
    if (salvage.stahl + salvage.elektronik > 0) cargo = addRes(cargo, salvage);
    const returnAt = p.plan.returnAtMs + Math.max(0, due - p.plan.arriveAtMs);
    await tx.update(tables.mission).set({ status: "returning", returning: finals[i], cargoHome: cargo, reportId, returnAt: new Date(returnAt) }).where(eq(tables.mission.id, p.mission.id));
    await scheduleEvent(tx, "mission_return", returnAt, { missionId: p.mission.id }, p.mission.baseId);
  }
  await tx.update(tables.allianceRaid).set({ status: "beendet", reportId }).where(eq(tables.allianceRaid.id, raid.id));

  const ids = parts.map((p) => p.playerId);
  const won = fight?.report?.winner === "attacker";
  const head = !fight ? `Das Ziel ${raid.targetName} gibt es nicht mehr; die Verbände kehren um.`
    : !fight.report ? `${fight.title}. Die Verbände kehren um.`
    : `${fight.title}: ${won ? "Sieg" : "Niederlage"}. Beute insgesamt: ${sum(total) > 0 ? resText(total) : "keine"}.`;
  const notes: Notes = [];
  for (let i = 0; i < parts.length; i++) {
    const mine = sum(shares[i]) > 0 ? resText(shares[i]) : "keine";
    await tx.insert(tables.message).values({ fromPlayerId: null, toPlayerId: parts[i].playerId, subject: "Sammelangriff: Ergebnis", body: `${head} Dein Beitrag ${pct[i]} %, deine Beute: ${mine}.`, createdAt: new Date(due) });
    push.push({ playerId: parts[i].playerId, notice: { kind: "report", title: `Kampfbericht: ${fight?.title ?? raid.targetName}`, body: `Dein Beitrag ${pct[i]} %, Beute: ${mine}.`, url: "/?tab=meldungen", tag: `raid-${raid.id}`, ...(reportId !== null ? { reportId } : {}) } });
  }
  notes.push([ids, "messages"], [ids, "reports"], [ids, "missions"], [await memberIds(tx, raid.allianceId), "alliance"]);
  return { notify: [...notify, ...notes], push };
};

