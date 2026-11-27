// Saisonfinale „Leviathan“: Kämpfe. Zielpunkt (Sammelpunkt oder nächste Vorhut), Vorschau (Abschnitt, Siegchance, Beute),
// Ankunft eines Überfalls und Sammelangriff. Die Armada stellt jedem Verband einen Abschnitt passend zu seinem Bezug K;
// Verluste bleiben, Beute je vernichtetem Lebenspunkt ohne Laderaumgrenze (Gutschrift bei der Heimkehr).
// Eingehängt in world-events-missions.ts (aim, Vorschau, Ankunft) und alliance-ops-battle.ts (fightEvent).
import { eq } from "drizzle-orm";
import {
  activeUnits,
  afterSector,
  combineModifiers,
  finaleLoot,
  finaleProbe,
  finaleSector,
  finaleSunk,
  finaleTreasure,
  finaleWarHp,
  forceHp,
  resolveBattle,
  settleBattle, victoryRuleOf, // Sieger nach Kampfart (wie der Simulator)
  type AttackerInput,
  type BattleReport,
  type Counts,
  type Mission,
  type Modifiers,
  type ResourceMap,
} from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables, type Tx } from "@tidefront/db";
import { balance, type ChangeKind, type NoticeJob } from "./context.ts";
import { randomSeed, type BaseRow } from "./store.ts";
import { modifiersFor } from "./modifiers.ts";
import { battleWeather } from "./weather.ts";
import { admiralsAfterBattle, type BattleAdmiral } from "./admirals-battle.ts";
import { closeFinale, creditFinale } from "./finale-core.ts";
import { addRes, notice, resText, type Hex, type WorldEventRow } from "./world-events.ts";
import type { Fight, Part } from "./alliance-ops-battle.ts";

const sum = (m: ResourceMap) => Object.values(m).reduce((a, b) => a + b, 0);
const EMPTY_LOOT = { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 };

/** Zielpunkt eines Verbands: der nächste von Sammelpunkt und Vorhuten; sind die Geschwader versenkt, nur der Sammelpunkt. */
export function finaleAim(ev: WorldEventRow, own: Hex): Hex & { name: string } {
  const center = { col: ev.col, row: ev.row, name: "Sammelpunkt" };
  const boats = ev.status !== "active" || ((ev.units as Counts).schnellboot ?? 0) > 0;
  const points = [center, ...(boats ? ev.data.finale?.vanguards ?? [] : [])];
  return points.reduce((best, p) => (hexDistanceKm(own, p) < hexDistanceKm(own, best) ? p : best), center);
}

/** Ankunft vor dem Erscheinen: finale_not_yet (die Armada ist noch nicht da). */
export function finaleTiming(ev: WorldEventRow, arriveAtMs: number): string | null {
  return ev.kind === "finale" && arriveAtMs < ev.activeAt.getTime() ? "finale_not_yet" : null;
}

/** Vorschau: Abschnitt für diesen Verband, Siegchance (Probekampf), erwarteter Schaden und Beute. */
export function finalePreview(ev: WorldEventRow, units: Counts, mods: Modifiers, target: Hex) {
  const k = finaleWarHp(units, balance);
  const atCenter = target.col === ev.col && target.row === ev.row;
  const point = finaleAim(ev, target);
  if (ev.status !== "active") return { k, sector: null, flagship: false, winRate: null, damageHp: 0, loot: {}, treasure: null, point: point.name };
  const sector = finaleSector(activeUnits(ev.units as Counts), k, balance);
  const fight = Object.keys(sector.defender).length > 0 && (atCenter || !sector.flagship);
  const p = fight ? finaleProbe({ units: units, modifiers: mods }, sector.defender, balance) : { winRate: 0, damageHp: 0 };
  const sinks = sector.flagship && p.winRate > 0;
  return {
    k, sector: sector.defender, flagship: sector.flagship, winRate: p.winRate, damageHp: Math.round(p.damageHp),
    loot: finaleLoot(p.damageHp, balance), treasure: sinks ? finaleTreasure(ev.data.finale?.totalHp ?? 0, balance) : null, point: point.name,
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

/** Kampf gegen den Abschnitt; Ergebnis für Einzel- und Sammelangriff. */
function sectorBattle(ev: WorldEventRow, attacker: AttackerInput, k: number, col: number, row: number, due: number) {
  const sector = finaleSector(activeUnits(ev.units as Counts), k, balance);
  const seed = randomSeed();
  const res = resolveBattle(attacker, { units: sector.defender, defenses: {} }, balance, seed, battleWeather(col, row, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const { report, destroyed } = settleBattle(res.report, balance, victoryRuleOf("weltereignis"));
  const survivors = activeUnits(report.defender.final);
  const destroyedHp = forceHp(sector.defender, balance) - forceHp(survivors, balance);
  const left = afterSector(ev.units as Counts, sector.defender, survivors);
  const sunk = finaleSunk(left);
  const treasure = sunk ? finaleTreasure(ev.data.finale?.totalHp ?? 0, balance) : {};
  const loot = addRes(finaleLoot(destroyedHp, balance), treasure);
  const title = sunk ? "Leviathan versenkt" : sector.flagship ? "Angriff auf den Leviathan" : destroyed ? "Abschnitt der Armada versenkt" : "Angriff auf die Kartell-Armada";
  const worldEvent = {
    id: ev.id, kind: ev.kind, destroyed: sunk, sectorDestroyed: destroyed, destroyedHp, initialHp: ev.data.initialHp, remaining: left,
    sector: sector.defender, flagship: sector.flagship, ...(sunk ? { treasure } : {}),
  };
  return { seed, report, sector, destroyedHp, left, sunk, loot, title, worldEvent };
}

/** Bericht ohne Kampf (Armada noch nicht da, schon weg oder Vorhut aufgelöst). */
async function emptyReport(tx: Tx, m: ArriveMission, ev: WorldEventRow, due: number, text: string): Promise<number> {
  const [r] = await tx.insert(tables.battleReport).values({
    attackerPlayerId: m.playerId, defenderPlayerId: null, attackerBaseId: m.baseId, defenderBaseId: null, nestId: null, balanceVersion: balance.version,
    createdAt: new Date(due), kind: "weltereignis_leer", title: "Kartell-Armada: kein Gegner", winner: null, seed: null,
    report: { worldEvent: { id: ev.id, kind: ev.kind, outcome: ev.outcome }, text },
  }).returning({ id: tables.battleReport.id });
  return r.id;
}

/** mission_arrive gegen das Finale (aus eventMissionArrive; das Ereignis ist gesperrt und offen). */
export async function finaleMissionArrive(
  tx: Tx, ev: WorldEventRow, m: ArriveMission, plan: Mission, origin: BaseRow | null, due: number, attackerName: string, admA: BattleAdmiral | null,
): Promise<{ returning: Counts; cargoHome: ResourceMap; reportId: number | null; notify: [number[] | null, ChangeKind][]; push: NoticeJob[] }> {
  const notify: [number[] | null, ChangeKind][] = [];
  const push: NoticeJob[] = [];
  const pid = m.playerId!;
  const atCenter = m.targetCol === ev.col && m.targetRow === ev.row;
  const k = finaleWarHp(plan.units, balance);
  const sector = finaleSector(activeUnits(ev.units as Counts), k, balance);
  const blocked = ev.status !== "active" ? "Die Armada ist noch nicht erschienen."
    : Object.keys(sector.defender).length === 0 ? "Die Armada ist schon versenkt."
    : sector.flagship && !atCenter ? "Die Geschwader sind versenkt – das Flaggschiff liegt am Sammelpunkt. Plane den nächsten Angriff dorthin."
    : null;
  if (blocked) return { returning: { ...plan.units }, cargoHome: {}, reportId: await emptyReport(tx, m, ev, due, blocked), notify, push };

  const modifiers = combineModifiers(await modifiersFor(tx, pid, { state: origin?.state ?? null, nowMs: due, baseId: origin?.id, isHome: origin?.isHome }), admA?.mods);
  const attacker: AttackerInput = { units: plan.units, versorgungsmangel: origin?.state.versorgungsmangel ?? false, modifiers };
  const b = sectorBattle(ev, attacker, k, m.targetCol, m.targetRow, due);
  const admirals = await admiralsAfterBattle(tx, b.report, b.seed, admA, null, due); // Admirale: Erfahrung, Schicksal
  const report = { ...b.report, loot: { ...EMPTY_LOOT, ...b.loot } };
  if ((report.wreck.stahl ?? 0) + (report.wreck.elektronik ?? 0) > 0) {
    await tx.insert(tables.wreck).values({ col: m.targetCol, row: m.targetRow, stahl: report.wreck.stahl ?? 0, elektronik: report.wreck.elektronik ?? 0, createdAt: new Date(due) });
  }
  const [r] = await tx.insert(tables.battleReport).values({
    attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, defenderBaseId: null, nestId: null, balanceVersion: balance.version,
    createdAt: new Date(due), kind: "weltereignis", title: b.title, winner: report.winner, seed: b.seed,
    report: {
      battle: report, attackerName, defenderName: "Kartell (Kartell-Armada)", targetName: b.sector.flagship ? "Flaggschiff Leviathan" : "Kartell-Armada", attacker,
      ...(admirals ? { admirals } : {}), worldEvent: b.worldEvent,
    },
  }).returning({ id: tables.battleReport.id });
  const data = await creditFinale(tx, ev, [{ playerId: pid, hp: b.destroyedHp, loot: b.loot }]);
  ev.units = b.left;
  ev.data = b.sunk ? { ...data, finale: { ...data.finale!, sunkAtMs: due } } : data;
  await tx.update(tables.worldEvent).set({ units: b.left, data: ev.data }).where(eq(tables.worldEvent.id, ev.id));
  notify.push([null, "map"]);
  if (b.sunk) {
    push.push(...(await closeFinale(tx, ev, "defeated", due, pid)));
    notify.push([null, "messages"]);
  }
  push.push(notice(pid, "report", `Kampfbericht: ${b.title}`, sum(b.loot) > 0 ? `Beute (bei der Heimkehr): ${resText(b.loot)}.` : "Keine Beute.", r.id));
  return { returning: activeUnits(b.report.attacker.final), cargoHome: b.loot, reportId: r.id, notify, push };
}

/**
 * Sammelangriff (aus fightEvent): ein Abschnitt aus dem gemeinsamen K aller Teilnehmer, Schaden und Beute nach Beitrag,
 * Beute ohne Laderaumgrenze; versenkt der Kampf das Flaggschiff, teilen die Teilnehmer den Schatz.
 */
export function finaleRaidFight(
  tx: Tx, parts: Part[], joint: AttackerInput, ev: WorldEventRow, col: number, row: number, due: number,
  notify: [number[] | null, ChangeKind][], push: NoticeJob[],
): Fight {
  const base = { defenderPlayerId: null, defenderBaseId: null, nestId: null, defenderName: "Kartell (Kartell-Armada)" };
  const k = parts.reduce((s, p) => s + finaleWarHp(p.plan.units, balance), 0);
  if (ev.status !== "active" || Object.keys(finaleSector(activeUnits(ev.units as Counts), k, balance).defender).length === 0) {
    return { ...base, kind: "weltereignis_leer", title: "Kartell-Armada: kein Gegner", report: null, loot: {},
      extra: { worldEvent: { id: ev.id, kind: ev.kind, outcome: ev.outcome }, text: ev.status !== "active" ? "Die Armada ist noch nicht erschienen." : "Die Armada ist schon versenkt." } };
  }
  const b = sectorBattle(ev, joint, k, col, row, due);
  return {
    ...base, kind: "weltereignis", title: `${b.title} (Sammelangriff)`, report: b.report as BattleReport, loot: b.loot, uncapped: true,
    extra: { seed: b.seed, worldEvent: b.worldEvent },
    commit: async (total, shares) => {
      const w = parts.map((p) => p.value);
      const W = w.reduce((a, x) => a + x, 0) || 1;
      const data = await creditFinale(tx, ev, parts.map((p, i) => ({ playerId: p.playerId, hp: (b.destroyedHp * w[i]) / W, loot: shares[i] })));
      ev.units = b.left;
      ev.data = b.sunk ? { ...data, finale: { ...data.finale!, sunkAtMs: due } } : data;
      await tx.update(tables.worldEvent).set({ units: b.left, data: ev.data }).where(eq(tables.worldEvent.id, ev.id));
      notify.push([null, "map"]);
      if (sum(total) > 0 && b.sunk) notify.push([null, "messages"]);
      if (b.sunk) push.push(...(await closeFinale(tx, ev, "defeated", due, parts[0].playerId)));
    },
  };
}
