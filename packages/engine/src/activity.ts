// Admin-Kennzahlen: Tages-Aktivität (Spieler, Tag) für die Kohorten-Retention und schlanke Erfassung von Meilensteinen,
// die sich nicht aus vorhandenen Daten ableiten lassen (KZ-Stufe, Missionsplätze, Startrampe, Satellit).
import { and, eq, sql } from "drizzle-orm";
import { missionSlots, type BaseState } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { dayKey } from "./challenge-pool.ts";
import { runningSeason } from "./season.ts";

/** Aktivität des Tages vermerken (idempotent: Primärschlüssel Spieler + Tag). Aufruf aus touchLastSeen. */
export async function recordActivity(db: DbOrTx, playerId: number, nowMs = Date.now()): Promise<void> {
  await db.insert(tables.playerActivityDay).values({ playerId, day: dayKey(nowMs) }).onConflictDoNothing();
}

/** Meilenstein-Schlüssel eines Spielers aus seinen Hafen-Zuständen; Wert = Zeitpunkt (ms) oder null = jetzt. */
export function milestoneKeys(states: BaseState[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  let kz = 0;
  let slots = 0;
  let rampe = false;
  let sat: number | null = null;
  for (const s of states) {
    kz = Math.max(kz, s.buildings?.kommandozentrale ?? 0);
    slots = Math.max(slots, missionSlots(s, balance));
    if ((s.buildings?.startrampe ?? 0) > 0) rampe = true;
    for (const x of s.satellites ?? []) sat = sat === null ? x.launchedAtMs : Math.min(sat, x.launchedAtMs);
  }
  for (let l = 1; l <= kz; l++) out.set(`kz:${l}`, null);
  for (let n = 1; n <= slots; n++) out.set(`slots:${n}`, null);
  if (rampe) out.set("startrampe", null);
  if (sat !== null) out.set("satellit", sat);
  return out;
}

/**
 * Worker (alle 10 Minuten): neue Meilensteine der laufenden Saison eintragen. Nur Menschen und KI-Spieler mit Hafen;
 * bereits erfasste Schlüssel bleiben unverändert. Rückgabe: Anzahl neuer Einträge.
 */
export async function recordMilestones(db: DbOrTx, nowMs = Date.now()): Promise<number> {
  const season = await runningSeason(db);
  if (!season) return 0;
  const seasonStart = season.startsAt.getTime();
  const bases = await db.select({ playerId: tables.base.playerId, state: tables.base.state }).from(tables.base);
  const byPlayer = new Map<number, BaseState[]>();
  for (const b of bases) byPlayer.set(b.playerId, [...(byPlayer.get(b.playerId) ?? []), b.state as BaseState]);
  const have = await db
    .select({ playerId: tables.playerMilestone.playerId, key: tables.playerMilestone.key })
    .from(tables.playerMilestone)
    .where(eq(tables.playerMilestone.seasonId, season.id));
  const known = new Set(have.map((h) => `${h.playerId}|${h.key}`));
  const values: { playerId: number; seasonId: number; key: string; reachedAt: Date }[] = [];
  for (const [playerId, states] of byPlayer) {
    for (const [key, at] of milestoneKeys(states)) {
      if (known.has(`${playerId}|${key}`)) continue;
      const ms = at === null ? nowMs : Math.min(nowMs, Math.max(seasonStart, at));
      values.push({ playerId, seasonId: season.id, key, reachedAt: new Date(ms) });
    }
  }
  let added = 0;
  for (let i = 0; i < values.length; i += 500) {
    const r = await db.insert(tables.playerMilestone).values(values.slice(i, i + 500)).onConflictDoNothing().returning({ k: tables.playerMilestone.key });
    added += r.length;
  }
  return added;
}

/** Aufräumen: Entprellungs-Einträge älter als 30 Tage (Rückhol-Schlüssel sind dann längst bedeutungslos). */
export async function cleanupNudges(db: DbOrTx): Promise<void> {
  await db.execute(sql`delete from player_nudge where created_at < now() - interval '30 days'`);
}

/** Einmal-Sperre: true, wenn dieser Aufruf den Schlüssel neu angelegt hat (dann versenden). */
export async function claimNudge(db: DbOrTx, playerId: number, key: string): Promise<boolean> {
  const r = await db.insert(tables.playerNudge).values({ playerId, key }).onConflictDoNothing().returning({ k: tables.playerNudge.key });
  return r.length > 0;
}

/** Für Tests: hat der Spieler den Schlüssel schon? */
export async function hasNudge(db: DbOrTx, playerId: number, key: string): Promise<boolean> {
  const r = await db.select({ k: tables.playerNudge.key }).from(tables.playerNudge)
    .where(and(eq(tables.playerNudge.playerId, playerId), eq(tables.playerNudge.key, key)));
  return r.length > 0;
}
