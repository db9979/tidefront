// Weltpolitik, Serverseite: Saisonplan lesen, wirksame Balance zu einem Zeitpunkt (balanceNow), Not-Aus je Baustein,
// aktive Menschen. Regeln: docs/REGELN-WELTPOLITIK.md. Der Plan liegt in politik_fenster; eine Abfrage je Aufruf
// (wenige Zeilen, Index auf Beginn/Ende) – nur die Produktionsquelle (modsOf, sehr häufig) hält 30 s vor.
import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import {
  balanceAt, EMPTY_PLAN, pickKind, politikNow, politikOf, setStormWindows, stormWindowsOf, type EffectiveBalance, type FensterEffect, type GezeitKind, type market, type PolitikPlan,
  type PolitikWindow,
} from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { getSettings } from "./settings.ts";
import { registerModifierSource } from "./modifiers.ts";
import { randomSeed } from "./store.ts";

const HOUR_MS = 3_600_000;

/** Not-Aus je Baustein (server_setting, Wert "1" = aus): ohne Auslieferung abschaltbar. */
export const POLITIK_OFF = { gezeit: "politik_gezeit_aus", seerat: "politik_seerat_aus", gesuche: "politik_gesuche_aus" } as const;
export type PolitikPart = keyof typeof POLITIK_OFF;

export async function politikOff(db: DbOrTx): Promise<Record<PolitikPart, boolean>> {
  const s = await getSettings(db, Object.values(POLITIK_OFF));
  return { gezeit: s.get(POLITIK_OFF.gezeit) === "1", seerat: s.get(POLITIK_OFF.seerat) === "1", gesuche: s.get(POLITIK_OFF.gesuche) === "1" };
}

export type FensterRow = typeof tables.politikFenster.$inferSelect;

export function toWindow(r: FensterRow): PolitikWindow {
  return {
    id: r.id, slot: r.slot as PolitikWindow["slot"], idx: r.idx, startMs: r.startsAt.getTime(), endMs: r.endsAt.getTime(),
    planKind: (r.planKind as GezeitKind | null) ?? null, good: r.good, effect: r.effect as FensterEffect, source: r.source as PolitikWindow["source"],
  };
}

/** Laufende Saison (id, Start, Ende) oder null. */
export async function politikSeason(db: DbOrTx): Promise<{ id: number; startMs: number; endMs: number } | null> {
  const [s] = await db.select({ id: tables.season.id, startsAt: tables.season.startsAt, endsAt: tables.season.endsAt })
    .from(tables.season).where(eq(tables.season.status, "running")).orderBy(desc(tables.season.number)).limit(1);
  return s ? { id: s.id, startMs: s.startsAt.getTime(), endMs: s.endsAt.getTime() } : null;
}

/** Ganzer Plan der laufenden Saison (für meta und Ansicht). Not-Aus Gezeit: Gezeit-Fenster aus dem Plan wirken nicht. */
export async function seasonPlan(db: DbOrTx): Promise<PolitikPlan> {
  if (!politikOf(balance)) return EMPTY_PLAN;
  const s = await politikSeason(db);
  if (!s) return EMPTY_PLAN;
  const rows = await db.select().from(tables.politikFenster).where(eq(tables.politikFenster.seasonId, s.id)).orderBy(tables.politikFenster.startsAt);
  return syncStorms(withOff(rows.map(toWindow), await politikOff(db)));
}

// ---------------------------------------------------------------- Sturmzeit im Wetterfeld (Stufe 2)

let stormSyncAt = Number.NEGATIVE_INFINITY;
const STORM_SYNC_MS = 60_000;

/** Sturmzeit-Fenster des Plans ins Wetterfeld (game-core/weather-storm.ts) übernehmen; gibt den Plan zurück. */
export function syncStorms(plan: PolitikPlan): PolitikPlan {
  setStormWindows(stormWindowsOf(balance, plan), balance.weather?.stormFrom ?? null);
  stormSyncAt = Date.now();
  return plan;
}

/** Höchstens einmal je Minute den Plan lesen, damit Wetterabfragen (Route, Kampf) die Sturmzeit kennen. */
export async function ensureStormSync(db: DbOrTx): Promise<void> {
  if (Math.abs(Date.now() - stormSyncAt) < STORM_SYNC_MS) return;
  stormSyncAt = Date.now();
  await seasonPlan(db);
}

function withOff(windows: PolitikWindow[], off: Record<PolitikPart, boolean>): PolitikPlan {
  return { windows: windows.map((w) => (off.gezeit && w.slot === "gezeit" && w.source === "plan" ? { ...w, effect: "ruhig" as const } : w)) };
}

/** Fenster, die zum Zeitpunkt ms wirken (über alle Saisons: Fenster enden vor dem Saisonende). */
export async function planAt(db: DbOrTx, ms: number): Promise<PolitikPlan> {
  if (!politikOf(balance)) return EMPTY_PLAN;
  const t = tables.politikFenster;
  const rows = await db.select().from(t).where(and(lte(t.startsAt, new Date(ms)), gt(t.endsAt, new Date(ms))));
  if (rows.length === 0) return EMPTY_PLAN;
  return withOff(rows.map(toWindow), await politikOff(db));
}

/** Wirksame Balance zum Zeitpunkt ms (Gezeit und Beschlüsse); ohne Wirkung die Grundbalance selbst. */
export async function balanceNow(db: DbOrTx, ms: number): Promise<EffectiveBalance> {
  await ensureStormSync(db); // Sturmzeit: Wetterfeld auf dem Stand des Plans halten
  return balanceAt(balance, await planAt(db, ms), ms);
}

/** Dieselbe wirksame Balance in der Sicht des Börsenkerns. */
export async function marketBalanceNow(db: DbOrTx, ms: number): Promise<market.MarketBalance> {
  return (await balanceNow(db, ms)) as unknown as market.MarketBalance;
}

/** Faktor auf die Gebühr im Spielerhandel (Handelsfrieden), 1 ohne Wirkung. */
export async function playerTradeFeeFactor(db: DbOrTx, ms: number): Promise<number> {
  return (await balanceNow(db, ms)).politikNow?.playerTradeFee ?? 1;
}

// ---------------------------------------------------------------- Produktion (Rohstoffboom) als Modifikator-Quelle

let prodCache: { atMs: number; plan: PolitikPlan } | null = null;
const PROD_CACHE_MS = 30_000;

/** Nach Änderungen am Plan (Seerat, Not-Aus, Tests): Zwischenspeicher der Produktionsquelle verwerfen. */
export function invalidatePolitikCache(): void {
  prodCache = null;
  stormSyncAt = Number.NEGATIVE_INFINITY; // Sturmzeit beim nächsten Zugriff neu lesen
}

registerModifierSource(async (db, _playerId, ctx) => {
  if (!politikOf(balance)) return null;
  const now = Date.now();
  if (!prodCache || Math.abs(now - prodCache.atMs) > PROD_CACHE_MS || Math.abs(ctx.nowMs - now) > PROD_CACHE_MS) {
    const plan = await planAt(db, ctx.nowMs);
    if (Math.abs(ctx.nowMs - now) > PROD_CACHE_MS) {
      const n = politikNow(balance, plan, ctx.nowMs);
      return n && Object.keys(n.production).length > 0 ? { production: n.production } : null;
    }
    prodCache = { atMs: now, plan };
  }
  const n = politikNow(balance, prodCache.plan, ctx.nowMs);
  return n && Object.keys(n.production).length > 0 ? { production: n.production } : null;
}, "gezeit", "Gezeit");

// ---------------------------------------------------------------- Menschen und KI-Spieler

/** Aktive Menschen: kein KI-Spieler, mit Hafen, in den letzten activeHours gesehen. */
export async function activeHumans(db: DbOrTx, nowMs: number): Promise<{ id: number; name: string }[]> {
  const hours = politikOf(balance)?.seerat.activeHours ?? 72;
  const p = tables.player;
  const rows = await db.selectDistinct({ id: p.id, name: p.name }).from(p).innerJoin(tables.base, eq(tables.base.playerId, p.id))
    .where(and(isNull(p.botProfile), gt(p.lastSeenAt, new Date(nowMs - hours * HOUR_MS))));
  return rows.sort((a, b) => a.id - b.id);
}

/** Aktive KI-Spieler mit Spielweise (abgeschaltete und gerade entfernte zählen nicht). */
export async function politikKis(db: DbOrTx): Promise<{ id: number; name: string; profile: string }[]> {
  const p = tables.player;
  const rows = await db.select({ id: p.id, name: p.name, profile: p.botProfile, settings: p.botSettings }).from(p).orderBy(p.id);
  return rows.filter((r) => {
    const s = (r.settings ?? {}) as { active?: boolean; removing?: boolean };
    return r.profile !== null && s.active !== false && !s.removing;
  }).map((r) => ({ id: r.id, name: r.name, profile: r.profile! }));
}

export const PROFILE_TEXT: Record<string, string> = { haendler: "Händler", festung: "Festung", freibeuter: "Freibeuter" };

// ---------------------------------------------------------------- Weltereignisse (Kartellfehde, Gemeinsame Aktion)

/** Art eines neu entstehenden Weltereignisses: in einer Kartellfehde neu gewürfelt mit den verschobenen Gewichten. */
export async function politikEventKind<K extends string>(db: DbOrTx, ms: number, wanted: K): Promise<K> {
  const eff = await balanceNow(db, ms);
  if (!eff.politikNow || Object.keys(eff.politikNow.kindWeights).length === 0) return wanted;
  return pickKind(randomSeed() / 4294967296, eff) as K;
}

/** Läuft gerade ein Gezeit-Fenster (Plan, nicht abgesagt, nicht „Ruhige See“)? */
export async function gezeitRunning(db: DbOrTx, ms: number): Promise<boolean> {
  return (await planAt(db, ms)).windows.some((w) => w.slot === "gezeit" && w.effect !== "ruhig");
}

/** Beute eines neu entstehenden Weltereignisses: Gemeinsame Aktion × worldEventLoot (loot und lootPool). */
export async function politikEventData<T extends { loot?: Record<string, number>; lootPool?: Record<string, number> }>(db: DbOrTx, ms: number, data: T): Promise<T> {
  const f = (await balanceNow(db, ms)).politikNow?.worldEventLoot ?? 1;
  if (f === 1) return data;
  const scale = (m?: Record<string, number>) => (m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * f)])) : m);
  return { ...data, ...(data.loot ? { loot: scale(data.loot) } : {}), ...(data.lootPool ? { lootPool: scale(data.lootPool) } : {}) };
}
