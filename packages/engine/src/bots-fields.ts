// KI-Spieler: Rohstofffelder besetzen – ausschließlich über missionPreview/launchMission („besetzen“ mit fieldId).
// Bewachte Felder nur nach Probekampf gegen die Feldwache (dieselbe Kampfrechnung, Sieg = Wache vernichtet wie im
// Feldkampf, siehe fields-missions.ts) und nur mit einem Verband, der als ganze Besatzung (stayAll) auch einen
// Kartellangriff der Stufe hält. Feldverband: Schiffe daheim ohne die halbe Heimwache; die Heimwache sinkt nur um
// diesen Verband. Fehlen Schiffe, merkt sich der Bot das Ziel: Überfälle lassen dann den Feldverband daheim, die
// Rüstung legt Schiffe nach.
import { and, eq, inArray } from "drizzle-orm";
import {
  missionSlots, resolveBattle, splitGarrison, strandTroops, type BaseState, type Counts, type Modifiers,
} from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables } from "@tidefront/db";
import { balance } from "./context.ts";
import { launchMission } from "./commands.ts";
import { missionPreview } from "./views.ts";
import { FIELD_TYPE, fieldName, fieldsView, rules } from "./fields-core.ts";
import { fmtInt, nameOf } from "./names.ts";
import type { TurnCtx } from "./bots-war.ts";
import { scoutNearest, scoutsUnknown } from "./bots-intel.ts"; // Lagebild
import { activeMissionCount, type BaseRow } from "./store.ts";

type Base = BaseRow & { state: BaseState };

/** Schiffe, die nicht ins Feld fahren (kein Kampfwert oder anderer Zweck). */
const NO_FIELD = new Set(["kolonieschiff", "minenleger", "minenraeumer", "landungsschiff"]);
/** Reichweite für Feldziele (km). */
const FIELD_RANGE_KM = 700;
/** Ein gemerktes Ziel verfällt nach dieser Zeit (dann wird neu gewählt). */
const TARGET_HOURS = 36;
/** Anteile des verfügbaren Verbands, die nacheinander probiert werden (kleinster passender zuerst). */
const SHARES = [0.25, 0.4, 0.6, 0.8, 1];

/** Kampfschiffe für Felder daheim; Heimwache während eines Feldangriffs halbiert (Händler: Hälfte der Schiffe). */
export function fieldShips(state: BaseState, homeGuardShare: number): Counts {
  const keep = Math.min(0.5, homeGuardShare / 2);
  const out: Counts = {};
  for (const [id, n] of Object.entries(state.units)) {
    const def = balance.units[id];
    if (!def || def.branch !== "see" || NO_FIELD.has(id) || (def.attack.see ?? 0) <= 0) continue;
    const k = Math.floor(n * (1 - keep));
    if (k > 0) out[id] = k;
  }
  return out;
}

/**
 * Probekampf gegen eine Feldwache: Anteil der Kämpfe, in denen die Wache vernichtet wird und die Überlebenden eine
 * gültige Besatzung bilden (wie der Feldkampf: `strandTroops`, `splitGarrison`).
 */
export function fieldProbe(units: Counts, guard: Counts, mods: Modifiers, runs: number): number {
  if (Object.values(guard).every((n) => n <= 0)) return 1;
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle({ units, modifiers: mods }, { units: guard, defenses: {} }, balance, Math.imul(i + 1, 0x9e3779b1) >>> 0);
    if (!r.ok) return 0;
    const s = strandTroops(r.report, balance);
    if (s.destroyed && splitGarrison(s.report.attacker.final, false, balance)) wins++;
  }
  return wins / runs;
}

/**
 * Probekampf der Besatzung gegen einen Kartellangriff aufs Feld (Kartell greift an, die Besatzung verteidigt):
 * Anteil der Kämpfe, in denen sie das Feld hält (nicht vernichtet wird).
 */
export function holdProbe(garrison: Counts, raid: Counts, runs: number): number {
  if (Object.values(raid).every((n) => n <= 0)) return 1;
  let held = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle({ units: raid }, { units: garrison, defenses: {} }, balance, Math.imul(i + 1, 0x9e3779b1) >>> 0);
    if (!r.ok) return 0;
    if (!strandTroops(r.report, balance).destroyed) held++;
  }
  return held / runs;
}

/**
 * Kleinster Teil des Verbands, der die Wache im Probekampf schlägt und danach als ganze Besatzung (stayAll) einen
 * Kartellangriff der Stufe hält (oder null). Eine Mindestbesatzung fällt auf Stufe 1 in 63 % der Kartellangriffe (J.3).
 */
export function smallestForce(ships: Counts, guard: Counts, raid: Counts, mods: Modifiers, runs: number, need: number): Counts | null {
  for (const share of SHARES) {
    const units: Counts = {};
    for (const [id, n] of Object.entries(ships)) {
      const k = Math.max(1, Math.ceil(n * share));
      units[id] = Math.min(n, k);
    }
    if (fieldProbe(units, guard, mods, runs) >= need && holdProbe(units, raid, runs) >= need) return units;
  }
  return null;
}

/** Feldverband, den Überfälle daheim lassen sollen (gemerktes Ziel), sonst leer. */
export function reservedForField(c: TurnCtx, baseId: number): Counts {
  const t = c.state.fieldTarget;
  if (!t || t.baseId !== baseId || t.untilMs <= c.nowMs) return {};
  return t.units;
}

/** Fehlt dem Bot ein Feld (Höchstzahl nicht erreicht)? Für die Rüstung (mehr Schiffe in der Doktrin). */
export function wantsField(c: TurnCtx): boolean {
  return c.cfg.fields !== "none" && !!c.state.fieldTarget && c.state.fieldTarget.untilMs > c.nowMs;
}

/** Rohstofffeld besetzen: freie Felder (alle Spielweisen außer „none“), bewachte nach Probekampf („all“). */
export async function fieldTurn(c: TurnCtx, base: Base, mods: Modifiers): Promise<boolean> {
  if (c.cfg.fields === "none" || !rules() || c.rand() < c.cfg.noise) return false;
  const view = await fieldsView(c.engine, c.bot.id);
  if (!view) return false;
  const pending = await c.engine.db.select({ targetId: tables.mission.targetId }).from(tables.mission).where(and(
    eq(tables.mission.playerId, c.bot.id), eq(tables.mission.type, FIELD_TYPE), eq(tables.mission.targetKind, "field"),
    inArray(tables.mission.status, ["outbound"]),
  ));
  const own = new Set(view.mine.map((m) => m.id));
  const busy = new Set(pending.map((p) => p.targetId));
  const goingNew = pending.filter((p) => p.targetId !== null && !own.has(p.targetId)).length;
  const slotsLeft = missionSlots(base.state, balance) - (await activeMissionCount(c.engine.db, base.id));
  const ships = fieldShips(base.state, c.cfg.homeGuardShare);
  const guards = rules()!.guard;
  const raids = rules()!.cartelRaid;
  const runs = Math.max(4, c.cfg.probeRuns);
  const need = Math.max(0.8, c.cfg.probeWinRate);
  // Verstärkung: Kartellangriffe zehren die Besatzung auf; hält sie den nächsten nicht mehr, Schiffe nachschicken.
  if (slotsLeft >= 1 && Object.keys(ships).length > 0) {
    for (const m of view.mine.filter((x) => x.baseId === base.id && !busy.has(x.id) && x.reinforcements.length === 0)) {
      const raid = raids[m.tier - 1] ?? {};
      if (holdProbe(m.defenders, raid, runs) >= need) continue;
      const add = smallestAdd(ships, m.defenders, raid, runs, need);
      if (!add) continue;
      const input = { type: FIELD_TYPE, units: add, col: m.col, row: m.row, fieldId: m.id, baseId: base.id };
      if (!(await missionPreview(c.engine, c.bot.id, input)).ok) continue;
      if ((await launchMission(c.engine, c.bot.id, c.key("reinforce"), input)).ok) {
        c.log.push(`Besatzung auf ${fieldName(m)} wird verstärkt (${countsText(add)}).`);
        return true;
      }
    }
  }
  if (view.mine.length + goingNew >= view.maxFields) {
    delete c.state.fieldTarget;
    return false;
  }
  // Die Besatzung belegt dauerhaft einen Missionsplatz: wer Nester angreift, lässt einen Platz für Überfälle frei.
  if (slotsLeft < (c.cfg.attackNests ? 2 : 1)) return false;
  const candidates = view.fields
    .filter((f) => !busy.has(f.id) && (f.relation === "frei" || (c.cfg.fields === "all" && f.relation === "kartell")))
    .map((f) => ({ ...f, d: hexDistanceKm(base, f) }))
    .filter((f) => f.d < FIELD_RANGE_KM)
    // Nahe und kleine Felder zuerst (Stufe 3 braucht etwa dreimal so viele Schiffe wie Stufe 1).
    .sort((a, b) => a.d * (1 + 0.5 * (a.tier - 1)) - b.d * (1 + 0.5 * (b.tier - 1)))
    .slice(0, 5);
  let wanted: { fieldId: number; units: Counts } | null = null;
  for (const f of candidates) {
    // Lagebild: bekannte Wache (eigene Aufklärung), sonst die Wache der Stufe aus dem Handbuch.
    const guard: Counts = f.relation === "frei" ? {} : (f.guard ?? guards[f.tier - 1] ?? {});
    const raid = raids[f.tier - 1] ?? {};
    const units = Object.keys(ships).length > 0 ? smallestForce(ships, guard, raid, mods, runs, need) : null;
    if (!units) {
      // Ziel merken: Verband, der Wache und Kartellangriff bestünde (Korvetten gerechnet, ohne Heimwache).
      if (!wanted) wanted = { fieldId: f.id, units: needFor(guard, raid, mods, runs, need) };
      continue;
    }
    // Der ganze Verband bleibt als Besatzung (stayAll): so hält er auch Kartellangriffe aufs Feld.
    const input = { type: FIELD_TYPE, units, col: f.col, row: f.row, fieldId: f.id, baseId: base.id, stayAll: true };
    const p = await missionPreview(c.engine, c.bot.id, input);
    if (!p.ok) continue;
    const r = await launchMission(c.engine, c.bot.id, c.key("field"), input);
    if (r.ok) {
      delete c.state.fieldTarget;
      c.log.push(`${fieldName(f)} wird besetzt (${countsText(units)}).`);
      return true;
    }
  }
  // Lagebild: Bots klären Felder ohne Erkennung auf (Freibeuter laufend, Festung und Händler mit Pause), solange er weniger als drei bekannte Ziele in Reichweite hat
  // (erst nach dem Versuch, ein bekanntes Feld zu nehmen).
  let scouted = false;
  if (candidates.length < 3 && scoutsUnknown(c, "field")) {
    const unknown = view.fields.filter((f) => f.relation === "unbekannt" && !busy.has(f.id))
      .map((f) => ({ key: `f${f.id}`, col: f.col, row: f.row, fieldId: f.id, label: `Rohstofffeld ${f.col}/${f.row}` }));
    scouted = await scoutNearest(c, base, unknown, FIELD_RANGE_KM, "field");
  }
  if (wanted) {
    const prev = c.state.fieldTarget;
    const keep = prev && prev.fieldId === wanted.fieldId && prev.untilMs > c.nowMs;
    c.state.fieldTarget = { ...wanted, baseId: base.id, untilMs: keep ? prev!.untilMs : c.nowMs + TARGET_HOURS * 3600000 };
  } else delete c.state.fieldTarget;
  return scouted;
}

const countsText = (u: Counts) => Object.entries(u).map(([id, n]) => `${fmtInt(n)} × ${nameOf(id)}`).join(", ");

/** Kleinste Verstärkung aus `ships`, mit der die Besatzung einen Kartellangriff der Stufe hält (oder null). */
export function smallestAdd(ships: Counts, garrison: Counts, raid: Counts, runs: number, need: number): Counts | null {
  for (const share of SHARES) {
    const add: Counts = {};
    for (const [id, n] of Object.entries(ships)) add[id] = Math.min(n, Math.max(1, Math.ceil(n * share)));
    const all: Counts = { ...garrison };
    for (const [id, n] of Object.entries(add)) all[id] = (all[id] ?? 0) + n;
    if (holdProbe(all, raid, runs) >= need) return add;
  }
  return null;
}

/** Bedarf gegen Wache und Kartellangriff in Korvetten (Rüstungsziel und Reserve; die Doktrin liefert auch Zerstörer). */
function needFor(guard: Counts, raid: Counts, mods: Modifiers, runs: number, need: number): Counts {
  for (let n = 3; n <= 24; n++) {
    if (fieldProbe({ korvette: n }, guard, mods, runs) >= need && holdProbe({ korvette: n }, raid, runs) >= need) return { korvette: n };
  }
  return { korvette: 24 };
}
