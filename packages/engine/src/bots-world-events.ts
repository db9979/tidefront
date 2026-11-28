// KI-Spieler und Weltereignisse (Welle 2, ST-06): Freibeuter und Festung greifen Schatzschiff, Großflotte und
// Belagerungsring an, wenn der Probekampf (feste Seeds, Siegregel „Gegner vernichtet“ wie im echten Kampf) im Mittel
// mindestens EVENT_PROBE_MIN gewinnt und der erwartete Verlust tragbar ist. Händler nehmen nicht teil (Profil: Handel).
// Früher griff keine KI ein Weltereignis an – alle liefen „entkommen/abgezogen/abgelaufen“ aus. Das Saisonfinale
// regelt bots-finale.ts. Alles über missionPreview/launchMission mit eventId wie bei Menschen; Ereignisse sind öffentlich.
import { and, eq, gt, inArray } from "drizzle-orm";
import {
  activeUnits,
  missionSlots,
  resolveBattle,
  settleBattle,
  victoryRuleOf,
  type AttackerInput,
  type BaseState,
  type Counts,
  type Modifiers,
} from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables } from "@tidefront/db";
import { balance } from "./context.ts";
import { launchMission } from "./commands.ts";
import { missionPreview } from "./views.ts";
import { activeMissionCount, type BaseRow } from "./store.ts";
import { reservedForField } from "./bots-fields.ts";
import { forceValue, guardShareOf, shipGuardShareOf, strikeForce, withoutReserve, type TurnCtx } from "./bots-war.ts";
import { KIND_TEXT, type WorldEventRow } from "./world-events.ts";

/** Nötige Siegquote (Ereignis vernichtet) im Probekampf. */
export const EVENT_PROBE_MIN = 0.9;
/** Erwarteter Verlust höchstens dieser Anteil am Wert des Verbands. */
export const EVENT_MAX_LOSS_SHARE = 0.35;
/** Läufe des Probekampfs gegen ein Ereignis (mindestens). */
export const EVENT_PROBE_RUNS = 8;
/** Größte Entfernung zum Ereignis (km). */
export const EVENT_RANGE_KM = 1200; // v1.35: 900 → 1200 (die Vorschau prüft, ob der Verband rechtzeitig ankommt)
const KINDS = ["schatzschiff", "grossflotte", "belagerung"] as const;

/** Verband gegen ein Ereignis auf See: Schiffe und Flugzeuge ohne Heimwache (Truppen kämpfen auf See nicht). */
export function eventForce(force: Counts): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(force)) if (n > 0 && balance.units[id] && balance.units[id].branch !== "land") out[id] = n;
  return out;
}

/** Probekampf gegen den Verband eines Ereignisses: Anteil „vernichtet“ und mittlerer Verlust (Richtwert). */
export function eventProbe(attacker: AttackerInput, units: Counts, runs: number): { winRate: number; lossValue: number } {
  let wins = 0, loss = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle(attacker, { units: activeUnits(units), defenses: {} }, balance, Math.imul(i + 1, 0x9e3779b1) >>> 0);
    if (!r.ok) return { winRate: 0, lossValue: Infinity };
    const s = settleBattle(r.report, balance, victoryRuleOf("weltereignis"));
    if (s.destroyed) wins++;
    const lost: Counts = {};
    for (const [id, n] of Object.entries(s.report.attacker.before)) lost[id] = Math.max(0, n - (s.report.attacker.final[id] ?? 0));
    loss += forceValue(lost);
  }
  return { winRate: wins / runs, lossValue: loss / runs };
}

/**
 * v1.35: Läuft ein gewöhnliches Weltereignis in Reichweite, das die KI noch nicht angreift, hält sie in diesem Hafen
 * einen Missionsplatz dafür frei (Nestfahrten und Aufklärung warten). Im Saisonlauf v1.34/Welle 2 waren die Plätze der
 * Festung mit Feldbesatzungen, Aufklärung und Nestfahrten belegt – sie griff nie ein Ereignis an. Nur Freibeuter/Festung.
 */
export async function keepSlotForEvent(c: TurnCtx, base: BaseRow & { state: BaseState }): Promise<boolean> {
  if (c.bot.profile === "haendler" || c.cfg.probeRuns <= 0) return false;
  const db = c.engine.db;
  if ((await activeMissionCount(db, base.id)) + 1 < missionSlots(base.state, balance)) return false;
  const rows = await db.select({ id: tables.worldEvent.id, col: tables.worldEvent.col, row: tables.worldEvent.row, units: tables.worldEvent.units }).from(tables.worldEvent).where(and(
    inArray(tables.worldEvent.kind, [...KINDS]), inArray(tables.worldEvent.status, ["announced", "active"]), gt(tables.worldEvent.endsAt, new Date(c.nowMs)),
  ));
  const near = rows.filter((e) => hexDistanceKm(base, e) <= EVENT_RANGE_KM);
  if (near.length === 0) return false;
  const busy = new Set((await db.select({ id: tables.mission.targetId }).from(tables.mission).where(and(
    eq(tables.mission.playerId, c.bot.id), eq(tables.mission.targetKind, "event"), inArray(tables.mission.status, ["outbound", "returning"]),
  ))).map((r) => r.id));
  // v1.36: nur für Ereignisse, die der Verband laut Probekampf auch schafft (sonst blockierte ein unerreichbares
  // Ereignis tagelang alle Nestfahrten – Saisonlauf: Freibeuter ohne Nest 4).
  const open = near.filter((e) => !busy.has(e.id));
  if (open.length === 0) return false;
  const force = eventForce(withoutReserve(strikeForce(base.state, guardShareOf(c), shipGuardShareOf(c)), reservedForField(c, base.id)));
  const fv = forceValue(force);
  if (fv < 2000) return false;
  return open.some((e) => {
    const p = eventProbe({ units: force }, e.units as Counts, EVENT_PROBE_RUNS);
    return p.winRate >= EVENT_PROBE_MIN && p.lossValue <= EVENT_MAX_LOSS_SHARE * fv;
  });
}

/** Ein Angriff auf ein laufendes Weltereignis aus diesem Hafen, wenn der Probekampf es erlaubt. Rückgabe: ausgelaufen. */
export async function raidWorldEvent(c: TurnCtx, base: BaseRow & { state: BaseState }, mods: Modifiers): Promise<boolean> {
  if (c.bot.profile === "haendler" || c.cfg.probeRuns <= 0) return false;
  const db = c.engine.db;
  const rows = (await db.select().from(tables.worldEvent).where(and(
    inArray(tables.worldEvent.kind, [...KINDS]), inArray(tables.worldEvent.status, ["announced", "active"]), gt(tables.worldEvent.endsAt, new Date(c.nowMs)),
  ))) as unknown as WorldEventRow[];
  if (rows.length === 0) return false;
  // v1.35: auch der letzte freie Missionsplatz darf an ein Weltereignis gehen (selten und befristet; vorher blieb immer
  // einer frei – mit Feldbesatzungen, Aufklärung und Nestfahrten griff die Festung im Saisonlauf nie ein Ereignis an).
  if ((await activeMissionCount(db, base.id)) >= missionSlots(base.state, balance)) return false;
  // Kein zweiter eigener Verband gegen dasselbe Ereignis.
  const busy = new Set((await db.select({ id: tables.mission.targetId }).from(tables.mission).where(and(
    eq(tables.mission.playerId, c.bot.id), eq(tables.mission.targetKind, "event"), eq(tables.mission.status, "outbound"),
  ))).map((r) => r.id));
  const force = eventForce(withoutReserve(strikeForce(base.state, guardShareOf(c), shipGuardShareOf(c)), reservedForField(c, base.id)));
  const fv = forceValue(force);
  if (fv < 2000) return false;
  const runs = Math.max(EVENT_PROBE_RUNS, c.cfg.probeRuns);
  const events = rows
    .filter((ev) => !busy.has(ev.id) && !(ev.kind === "belagerung" && ev.data.ownerId === c.bot.id && ev.targetBaseId === base.id))
    .map((ev) => ({ ev, d: hexDistanceKm(base, ev) }))
    .filter((x) => x.d <= EVENT_RANGE_KM)
    .sort((a, b) => a.d - b.d);
  for (const { ev, d } of events.slice(0, 3)) {
    const p = eventProbe({ units: force, modifiers: mods }, ev.units as Counts, runs);
    if (p.winRate < EVENT_PROBE_MIN || p.lossValue > EVENT_MAX_LOSS_SHARE * fv) continue;
    // v1.35: Lehnt die Planung ab (Flugzeuge außer Reichweite, mit Landungsschiffen – 40 km/h – zu spät am Abfangpunkt
    // oder nach dem Ende), fährt der Verband ohne diese – lieber Kampf ohne Laderaum als gar kein Angriff (Saisonlauf:
    // Festung nie). Der Probekampf muss auch für den kleineren Verband reichen.
    // Zuletzt fliegen nur die Flugzeuge in Reichweite (schnell genug für jeden Abfangpunkt, aber ohne Laderaum).
    let input = { type: "ueberfall", units: force, col: ev.col, row: ev.row, eventId: ev.id, baseId: base.id };
    let pv = await missionPreview(c.engine, c.bot.id, input);
    const inRange = (id: string) => balance.units[id]?.branch !== "luft" || (balance.units[id].rangeKm ?? 0) >= d;
    const pick = (keep: (id: string) => boolean): Counts => Object.fromEntries(Object.entries(force).filter(([id]) => keep(id)));
    for (const alt of [pick((id) => id !== "landungsschiff" && inRange(id)), pick((id) => balance.units[id]?.branch === "luft" && inRange(id))]) {
      if (pv.ok) break;
      if (Object.keys(alt).length === 0) continue;
      const pa = eventProbe({ units: alt, modifiers: mods }, ev.units as Counts, runs);
      if (pa.winRate < EVENT_PROBE_MIN || pa.lossValue > EVENT_MAX_LOSS_SHARE * forceValue(alt)) continue;
      input = { ...input, units: alt };
      pv = await missionPreview(c.engine, c.bot.id, input);
    }
    if (!pv.ok) continue;
    const r = await launchMission(c.engine, c.bot.id, c.key("event"), input);
    if (r.ok) {
      c.log.push(`${base.name}: Angriff auf ${KIND_TEXT[ev.kind]} (${Math.round(d)} km).`);
      return true;
    }
  }
  return false;
}
