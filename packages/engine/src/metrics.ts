// Messbarkeit (Welle 2, AN-03/AN-13): Tagesschnappschuss je Hafen und Nutzungszähler je System. Beides schreibt der
// Worker in der Wartung (worker-steps.ts) – billig: der Schnappschuss nur in der ersten Runde eines Kalendertags, die
// Nutzungszähler einmal je abgeschlossenem Tag aus dem Befehlsprotokoll (kein zusätzlicher Schreibzugriff je Befehl).
import { and, eq, gte, sql } from "drizzle-orm";
import { productionRates, settle, storageCapacity, type BaseState, type Counts } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { addDays, dayKey, gameTimeZone } from "./challenge-pool.ts";
import { modsOf } from "./modifiers.ts";
import { runningSeason } from "./season.ts";

/** Wert von Einheiten und Anlagen zum Richtpreis (wie die Wertung: Kosten × Richtpreis). */
export function militaryValue(s: Pick<BaseState, "units" | "unitsAway" | "defenses">): number {
  const price = balance.market.refPrice;
  const val = (id: string) => {
    const u = balance.units[id] ?? balance.defenses[id];
    return u ? Object.entries(u.cost ?? {}).reduce((a, [r, n]) => a + n * (price[r] ?? 1), 0) : 0;
  };
  let v = 0;
  for (const src of [s.units, s.unitsAway, s.defenses] as (Counts | undefined)[]) for (const [id, n] of Object.entries(src ?? {})) v += val(id) * Math.max(0, n);
  return v;
}

/**
 * Tagesschnappschuss aller Häfen (Tabelle base_day), höchstens einmal je Kalendertag: gibt es für heute schon Zeilen,
 * passiert nichts. Rückgabe: Anzahl neuer Zeilen.
 */
export async function snapshotBases(db: DbOrTx, nowMs = Date.now()): Promise<number> {
  const day = dayKey(nowMs);
  const [have] = await db.select({ d: tables.baseDay.day }).from(tables.baseDay).where(eq(tables.baseDay.day, day)).limit(1);
  if (have) return 0;
  const season = await runningSeason(db);
  const rows = await db.select({
    id: tables.base.id, playerId: tables.base.playerId, isHome: tables.base.isHome, state: tables.base.state,
    bot: sql<boolean>`${tables.player.botProfile} is not null`, trader: tables.player.trader,
  }).from(tables.base).innerJoin(tables.player, eq(tables.player.id, tables.base.playerId));
  const values: (typeof tables.baseDay.$inferInsert)[] = [];
  for (const b of rows) {
    const mods = await modsOf(db, { id: b.id, playerId: b.playerId, isHome: b.isHome, state: b.state as BaseState }, nowMs);
    const s = settle(b.state as BaseState, nowMs, balance, mods);
    const pr = productionRates(s, balance, mods, nowMs);
    const round = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    values.push({
      day, baseId: b.id, playerId: b.playerId, bot: b.bot, seasonId: season?.id ?? null,
      resources: round(s.resources), perHour: round(pr.perHour), capacity: storageCapacity(s, balance, mods),
      levels: Object.values(s.buildings).reduce((a, n) => a + n, 0), kz: s.buildings.kommandozentrale ?? 0,
      military: Math.round(militaryValue(s)),
      credits: b.isHome ? Math.round(((b.trader as { credits?: number } | null)?.credits ?? 0) * 100) / 100 : null,
    });
  }
  for (let i = 0; i < values.length; i += 200) await db.insert(tables.baseDay).values(values.slice(i, i + 200)).onConflictDoNothing();
  return values.length;
}

/** Systeme der Nutzungszähler: Befehlsname (command_log.command) → System. Erste passende Regel gewinnt. */
export const SYSTEMS: [string, RegExp][] = [
  ["bau", /^(upgrade|cancelBuild)$/],
  ["ausbildung", /^(train|cancelTrain)$/],
  ["forschung", /^research/],
  ["boerse", /^trade$/],
  ["spielerhandel", /^offer/],
  ["vertraege", /^contract/],
  ["felder", /^field/],
  ["admirale", /^admiral/],
  ["allianz-ops", /^(raid|station)/],
  ["lagebild", /^(intel:|spy$|satellite$|post|patrol)/],
  ["strom", /^cable/],
  ["befehle", /^(dailyClaim|dailyReroll|weeklyClaim)$/],
  ["auftragsbuch", /^guideClaim/],
  ["missionen", /^(mission|recall|liftBlockade)$/],
  ["hafen", /^(chooseBase|baseRename|baseAbandon|nightShield)$/],
];

/** System eines Befehls (sonstiges, wenn keine Regel passt). */
export function systemOf(command: string): string {
  for (const [name, re] of SYSTEMS) if (re.test(command)) return name;
  return "sonstiges";
}

/** Tage, die die Nutzungszähler rückwirkend verdichten (command_log hält 7 Tage). */
export const USAGE_BACKFILL_DAYS = 6;

/**
 * Nutzungszähler (usage_day) für abgeschlossene Tage nachtragen, die noch fehlen (höchstens USAGE_BACKFILL_DAYS
 * zurück). Je Tag eine Abfrage über das Befehlsprotokoll; nur erfolgreiche Befehle zählen. Rückgabe: verdichtete Tage.
 */
export async function recordUsage(db: DbOrTx, nowMs = Date.now()): Promise<number> {
  const today = dayKey(nowMs);
  const from = addDays(today, -USAGE_BACKFILL_DAYS);
  const done = new Set((await db.select({ d: tables.usageDay.day }).from(tables.usageDay)
    .where(and(eq(tables.usageDay.system, "gesamt"), gte(tables.usageDay.day, from)))).map((r) => r.d));
  const tz = gameTimeZone();
  let n = 0;
  for (let d = from; d < today; d = addDays(d, 1)) {
    if (done.has(d)) continue;
    const rows = await db.execute<{ command: string; player_id: number; bot: boolean; n: number }>(sql`
      select c.command, c.player_id, p.bot_profile is not null as bot, count(*)::int as n
      from command_log c join player p on p.id = c.player_id
      where to_char(c.created_at at time zone ${tz}, 'YYYY-MM-DD') = ${d} and (c.response->>'ok') = 'true'
      group by 1, 2, 3`);
    const agg = new Map<string, { humans: Set<number>; humanUses: number; bots: Set<number>; botUses: number }>();
    const bump = (sys: string, r: (typeof rows)[number]) => {
      const a = agg.get(sys) ?? { humans: new Set(), humanUses: 0, bots: new Set(), botUses: 0 };
      if (r.bot) { a.bots.add(r.player_id); a.botUses += r.n; } else { a.humans.add(r.player_id); a.humanUses += r.n; }
      agg.set(sys, a);
    };
    for (const r of rows) { bump(systemOf(r.command), r); bump("gesamt", r); }
    if (!agg.has("gesamt")) agg.set("gesamt", { humans: new Set(), humanUses: 0, bots: new Set(), botUses: 0 });
    const values = [...agg].map(([system, a]) => ({ day: d, system, humans: a.humans.size, humanUses: a.humanUses, bots: a.bots.size, botUses: a.botUses }));
    await db.insert(tables.usageDay).values(values).onConflictDoNothing();
    n++;
  }
  return n;
}
