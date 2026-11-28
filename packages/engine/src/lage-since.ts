// Rückkehrkarte „Seit deinem letzten Besuch“ (UX 0.43, B1 / Entscheidung E-3b): was seit der letzten Quittung
// (player.lage_ack_at) passiert ist – Kämpfe mit Beute, fertige Bauten/Ausbildungen, Rangänderung (Schnappschuss
// player.lage_ack_rank), neue Nachrichten mit Absender, gezählte Produktion. Ereignisgesteuert: `show` nur, wenn
// etwas davon vorliegt (Produktion erst ab 10 % des Lagers). Quittung (lage.ack) beim Abholen oder Schließen.
// Grundlage summary.ts (Morgenbericht); Rückblick höchstens 72 h (summary_entry wird nach 3 Tagen gelöscht).
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { productionRates, settle, storageCapacity, type ResourceMap } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { basesOfPlayer } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { buildSummary } from "./summary.ts";
import { rankingView } from "./social.ts";

const HOUR_MS = 3_600_000;
/** Höchster Rückblick (die Mitschrift summary_entry hält 3 Tage). */
export const SINCE_MAX_MS = 72 * HOUR_MS;
/** Ohne bisherige Quittung: so weit zurück. */
export const SINCE_DEFAULT_MS = 24 * HOUR_MS;
/** Produktion zählt als Anlass ab diesem Anteil des Lagers. */
export const SINCE_PRODUCTION_SHARE = 0.1;
const MAX_ITEMS = 5;

export interface LageSince {
  fromMs: number;
  toMs: number;
  /** Rückblick gekappt (letzte Quittung älter als SINCE_MAX_MS). */
  capped: boolean;
  /** Noch nie quittiert (Rückblick SINCE_DEFAULT_MS). */
  first: boolean;
  /** Etwas ist passiert – Karte zeigen. */
  show: boolean;
  battles: { total: number; won: number; lootGained: ResourceMap; lootLost: ResourceMap; items: { title: string; won: boolean; role: "attacker" | "defender"; atMs: number }[] };
  done: { builds: string[]; trainings: number; fleets: number; deliveries: number };
  rank: { before: number | null; now: number; of: number } | null;
  messages: { count: number; items: { id: number; from: string | null; subject: string | null }[] };
  /** Geschätzte Produktion aller Häfen im Zeitraum (Rate jetzt × Stunden, je Hafen bis zur Lagergrenze). */
  production: { share: number; amounts: ResourceMap } | null;
}

async function ownRank(engine: Engine, playerId: number): Promise<{ rank: number; of: number } | null> {
  try {
    const rv = await rankingView(engine, playerId);
    const own = rv.rows.find((r) => r.own);
    return own ? { rank: own.rank, of: rv.rows.length } : null;
  } catch (err) {
    engine.log("lage since rank", String(err));
    return null;
  }
}

/** Rückblick seit der letzten Quittung. */
export async function lageSince(engine: Engine, playerId: number, nowMs = Date.now()): Promise<LageSince> {
  const db = engine.db;
  const [p] = await db.select({ ackAt: tables.player.lageAckAt, ackRank: tables.player.lageAckRank, createdAt: tables.player.createdAt }).from(tables.player).where(eq(tables.player.id, playerId));
  const ack = p?.ackAt?.getTime() ?? null;
  // Nie vor der Anmeldung (neue Spieler: kein „seit gestern“).
  const fromMs = Math.min(nowMs, Math.max(p?.createdAt.getTime() ?? 0, ack === null ? nowMs - SINCE_DEFAULT_MS : Math.max(ack, nowMs - SINCE_MAX_MS)));
  const d = await buildSummary(engine, playerId, fromMs, nowMs);
  const won = d.battles.filter((b) => b.won).length;
  const builds = d.entries.filter((e) => e.kind === "build").map((e) => e.body.replace(/\.$/, ""));
  const count = (k: string) => d.entries.filter((e) => e.kind === k).length;
  const m = tables.message;
  const msgs = await db.select({ id: m.id, from: m.fromPlayerId, subject: m.subject }).from(m)
    .where(and(eq(m.toPlayerId, playerId), gt(m.createdAt, new Date(fromMs)))).orderBy(desc(m.createdAt)).limit(MAX_ITEMS);
  const senders = [...new Set(msgs.map((x) => x.from).filter((x): x is number => x !== null))];
  const names = new Map(senders.length === 0 ? [] : (await db.select({ id: tables.player.id, name: tables.player.name }).from(tables.player).where(inArray(tables.player.id, senders))).map((x) => [x.id, x.name]));
  const now = await ownRank(engine, playerId);
  const rank = now ? { before: p?.ackRank ?? null, now: now.rank, of: now.of } : null;
  // Produktion: je Hafen Rate jetzt × Stunden, höchstens bis zur Lagergrenze; Anteil = größter Anteil am Lager.
  const hours = (nowMs - fromMs) / HOUR_MS;
  const amounts: ResourceMap = {};
  let share = 0;
  for (const b of await basesOfPlayer(db, playerId)) {
    const mods = await modsOf(db, b, nowMs);
    const s = settle(b.state, nowMs, balance, mods);
    const cap = storageCapacity(s, balance, mods);
    const rates = productionRates(s, balance, mods, nowMs).perHour;
    for (const r of balance.resources) {
      const got = Math.max(0, Math.min(cap, (rates[r] ?? 0) * hours));
      if (got <= 0) continue;
      amounts[r] = Math.round((amounts[r] ?? 0) + got);
      if (cap > 0) share = Math.max(share, got / cap);
    }
  }
  const production = share >= SINCE_PRODUCTION_SHARE ? { share: Math.min(1, share), amounts } : null;
  const rankMoved = !!rank && rank.before !== null && rank.before !== rank.now;
  const show = d.battles.length > 0 || builds.length > 0 || count("training") > 0 || rankMoved || msgs.length > 0 || production !== null;
  return {
    fromMs, toMs: nowMs, capped: ack !== null && ack < nowMs - SINCE_MAX_MS, first: ack === null, show,
    battles: { total: d.battles.length, won, lootGained: d.lootGained, lootLost: d.lootLost,
      items: [...d.battles].reverse().slice(0, MAX_ITEMS).map((b) => ({ title: b.title, won: b.won, role: b.role, atMs: b.atMs })) },
    done: { builds: builds.slice(-MAX_ITEMS), trainings: count("training"), fleets: count("fleet"), deliveries: count("delivery") },
    rank,
    messages: { count: d.messages.received, items: msgs.map((x) => ({ id: x.id, from: x.from === null ? null : names.get(x.from) ?? null, subject: x.subject })) },
    production,
  };
}

/** Quittung: Rückkehrkarte geschlossen oder abgeholt – Zeitpunkt und Rang merken. */
export async function lageAck(engine: Engine, playerId: number, nowMs = Date.now()): Promise<{ ok: true; atMs: number }> {
  const r = await ownRank(engine, playerId);
  await engine.db.update(tables.player).set({ lageAckAt: new Date(nowMs), lageAckRank: r?.rank ?? null }).where(eq(tables.player.id, playerId));
  return { ok: true, atMs: nowMs };
}
