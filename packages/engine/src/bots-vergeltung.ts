// KI-Vergeltung (v1.35, Nutzerentscheid 5B): Überfällt ein Mensch einen KI-Spieler, schlägt die KI zurück – auch wenn
// „Darf Menschen angreifen“ aus ist. Server-Einstellung „Vergeltung“ (server_setting bots_vergeltung, Standard an).
// Regeln: nur gegen den menschlichen Angreifer (dessen Ausgangshafen), höchstens einmal je VERGELTUNG_HOURS, nur wenn
// der Probekampf gegen das eigene Lagebild (Aufklärung) mindestens VERGELTUNG_PROBE_MIN gewinnt; alle Schutzregeln
// (Anfängerschutz, Nachtschild, Schutz nach Niederlage, Diplomatie) prüft der Befehl selbst, dazu die Sperrfrist je Mensch.
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { BaseState, DefenderInput, Modifiers } from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { botsConfig } from "./bots-core.ts";
import { getSetting, setSetting } from "./settings.ts";
import type { BaseRow } from "./store.ts";
import {
  forceValue, humanCooldownActive, lastScout, probe, tryLaunch, type TurnCtx, raidForce } from "./bots-war.ts";

export const VERGELTUNG_SETTING = "bots_vergeltung";
/** Höchstens eine Vergeltung je so viele Stunden (je KI-Spieler). */
export const VERGELTUNG_HOURS = 24;
/** Nötige Siegquote im Probekampf. */
export const VERGELTUNG_PROBE_MIN = 0.75;
/** Überfälle, auf die noch geantwortet wird, liegen höchstens so weit zurück. */
export const VERGELTUNG_WINDOW_HOURS = 24;
const MAX_RANGE_KM = 900;
const HOUR_MS = 3600000;

/** Ist die Vergeltung eingeschaltet? (ohne Eintrag: an) */
export async function vergeltungOn(db: DbOrTx): Promise<boolean> {
  return (await getSetting(db, VERGELTUNG_SETTING)) !== "0";
}

export async function setVergeltung(db: DbOrTx, on: boolean): Promise<void> {
  await setSetting(db, VERGELTUNG_SETTING, on ? "1" : "0");
}

/** Darf der Bot jetzt (wieder) vergelten? Höchstens einmal je VERGELTUNG_HOURS. */
export function vergeltungDue(state: { revengeAtMs?: number }, nowMs: number): boolean {
  return state.revengeAtMs === undefined || nowMs - state.revengeAtMs >= VERGELTUNG_HOURS * HOUR_MS;
}

/** Jüngster unbeantworteter Überfall eines Menschen auf diesen Bot (Kampfbericht) im Fenster. */
async function lastHumanRaid(c: TurnCtx) {
  const since = new Date(c.nowMs - VERGELTUNG_WINDOW_HOURS * HOUR_MS);
  const br = tables.battleReport;
  const [r] = await c.engine.db
    .select({ id: br.id, attackerPlayerId: br.attackerPlayerId, attackerBaseId: br.attackerBaseId })
    .from(br)
    .innerJoin(tables.player, eq(tables.player.id, br.attackerPlayerId))
    .where(and(
      eq(br.defenderPlayerId, c.bot.id), inArray(br.kind, ["ueberfall", "sammelangriff"]), gt(br.createdAt, since),
      gt(br.id, c.state.revengeReportId ?? 0), isNull(tables.player.botProfile),
    ))
    .orderBy(desc(br.id))
    .limit(1);
  return r ?? null;
}

/**
 * Vergeltung aus diesem Hafen: erst Aufklärung des Angreiferhafens, dann Überfall bei Probekampf ≥ VERGELTUNG_PROBE_MIN.
 * Rückgabe: ein Verband ist ausgelaufen.
 */
export async function retaliate(c: TurnCtx, base: BaseRow & { state: BaseState }, mods: Modifiers): Promise<boolean> {
  if (c.cfg.probeRuns <= 0 || !vergeltungDue(c.state, c.nowMs)) return false;
  if (!(await vergeltungOn(c.engine.db))) return false;
  const raid = await lastHumanRaid(c);
  if (!raid || raid.attackerPlayerId === null || raid.attackerBaseId === null) return false;
  const [target] = await c.engine.db.select({ id: tables.base.id, playerId: tables.base.playerId, col: tables.base.col, row: tables.base.row })
    .from(tables.base).where(eq(tables.base.id, raid.attackerBaseId));
  if (!target || target.playerId !== raid.attackerPlayerId || hexDistanceKm(base, target) > MAX_RANGE_KM) return false;
  if (await humanCooldownActive(c, target.playerId)) return false;
  const force = raidForce(c, base);
  if (forceValue(force) < 3000) return false;
  const scout = await lastScout(c, target.id);
  if (!scout) {
    const sent = c.state.recon?.[String(target.id)];
    if (sent && c.nowMs - sent < botsConfig().reconMaxAgeHours * HOUR_MS) return false;
    const unit = (base.state.units.aufklaerungsdrohne ?? 0) > 0 ? "aufklaerungsdrohne" : (base.state.units.korvette ?? 0) > 0 ? "korvette" : null;
    if (!unit) return false;
    const ok = await tryLaunch(c, { type: "aufklaerung", units: { [unit]: 1 }, col: target.col, row: target.row, baseId: base.id }, `Vergeltung: Aufklärung gegen Hafen ${target.col}/${target.row}.`);
    if (ok) c.state.recon = { ...(c.state.recon ?? {}), [String(target.id)]: c.nowMs };
    return ok;
  }
  const defender: DefenderInput = { units: scout.units, defenses: scout.defenses, resources: scout.resources, protectedPerResource: scout.protectedPerResource };
  const p = probe({ units: force, modifiers: mods }, defender, Math.max(8, c.cfg.probeRuns));
  if (p.winRate < VERGELTUNG_PROBE_MIN) {
    c.state.revengeReportId = raid.id; // zu stark: diesen Überfall nicht weiter verfolgen
    return false;
  }
  const ok = await tryLaunch(c, { type: "ueberfall", units: force, col: target.col, row: target.row, baseId: base.id }, `Vergeltung: Überfall auf Hafen ${target.col}/${target.row}.`);
  if (ok) {
    c.state.revengeAtMs = c.nowMs;
    c.state.revengeReportId = raid.id;
  }
  return ok;
}
