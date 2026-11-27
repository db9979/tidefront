// Marktnachrichten: Anlässe. Weltereignisse (Hooks bei Beginn und Ende, dazu Abgleich im Worker), Kriegslage,
// Knappheit (einmal täglich) und Saisonende. runMarketNews ist der Worker-Job (alle 10 Minuten).
import { and, count, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { finaleBalance, market as marketCore, productionRates, settle, storageCapacity, type BaseState } from "@tidefront/game-core";
import { tables, type Db, type Tx } from "@tidefront/db";
import { balance, type Engine, type NoticeJob } from "./context.ts";
import { getSetting, setSetting } from "./settings.ts";
import {
  afterNewsRun, closeNews, collectNewsPush, newsBalance, persistRefOffsets, RES_NAME, SCARCITY_KEY, upsertNews, type NewsSpec,
} from "./market-news.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Beendete Ereignisse, deren Nachrichten noch abgeglichen werden (längstes Halten + Abklingen). */
const ENDED_LOOKBACK_MS = 48 * HOUR_MS;

type EventRow = typeof tables.worldEvent.$inferSelect;
interface EventData {
  strength?: number;
  baseName?: string;
  targets?: { name: string }[];
}

/** Gewünschte Nachrichten eines Weltereignisses zu nowMs (leer, wenn es keine Wirkung hat). */
export function worldEventSpecs(ev: EventRow, nowMs: number): NewsSpec[] {
  const cfg = newsBalance()?.worldEvents;
  if (!cfg) return [];
  const data = (ev.data ?? {}) as EventData;
  const key = `we:${ev.id}`;
  const open = ev.status === "announced" || ev.status === "active";
  const endedMs = ev.endedAt?.getTime() ?? ev.endsAt.getTime();
  // Laufend: volle Wirkung mindestens bis zum geplanten Ende und eine Stunde über jetzt hinaus (Abgleich verlängert).
  const endMs = open ? Math.max(ev.endsAt.getTime(), nowMs + HOUR_MS) : endedMs;
  const specs = (pcts: Record<string, number>, reason: string, startMs: number, end: number, fadeHours: number): NewsSpec[] =>
    Object.entries(pcts).map(([resource, pct]) => ({
      key, source: "weltereignis", resource, pct, reason, startMs, endMs: end, fadeMs: fadeHours * HOUR_MS,
    }));
  if (ev.kind === "grossflotte") {
    const where = data.targets?.[0]?.name;
    const reason = `${ev.status === "announced" ? "Großflotte angekündigt" : "Großflotte"}${where ? ` vor ${where}` : ""}`;
    return specs(marketCore.grossflottePcts(data.strength ?? 1, cfg.grossflotte), reason, ev.startsAt.getTime(), endMs, cfg.grossflotte.fadeHours);
  }
  if (ev.kind === "belagerung") {
    return specs(cfg.belagerung.pct, `Belagerung von ${data.baseName ?? "einem Hafen"}`, ev.startsAt.getTime(), endMs, cfg.belagerung.fadeHours);
  }
  if (ev.kind === "finale" && (ev.status === "active" || ev.outcome === "defeated" || ev.outcome === "escaped")) { // Saisonfinale: Treibstoff zieht an (wie Kriegslage)
    const c = finaleBalance(balance)?.market;
    if (c) return specs(c.pct, "Kartell-Armada vor der Küste", ev.activeAt.getTime(), endMs, c.fadeHours);
  }
  if (ev.kind === "schatzschiff" && !open) {
    if (ev.outcome === "defeated") {
      const c = cfg.schatzschiffErbeutet;
      return specs(c.pct, "Schatzschiff erbeutet – Beute kommt auf den Markt", endedMs, endedMs + c.holdHours * HOUR_MS, c.fadeHours);
    }
    if (ev.outcome === "escaped") {
      const c = cfg.schatzschiffEntkommen;
      return specs(c.pct, "Schatzschiff entkommen – Ladung verloren", endedMs, endedMs + c.holdHours * HOUR_MS, c.fadeHours);
    }
  }
  return [];
}

/** Hook (Weltereignis entsteht oder endet) und Abgleich: Nachrichten eines Ereignisses anlegen bzw. fortschreiben. */
export async function worldEventNews(tx: Tx, eventId: number, nowMs: number): Promise<boolean> {
  if (!newsBalance()) return false;
  const [ev] = await tx.select().from(tables.worldEvent).where(eq(tables.worldEvent.id, eventId));
  if (!ev) return false;
  let changed = false;
  for (const spec of worldEventSpecs(ev, nowMs)) changed = (await upsertNews(tx, spec, nowMs)) || changed;
  return changed;
}

async function syncWorldEvents(tx: Tx, nowMs: number): Promise<boolean> {
  const rows = await tx
    .select({ id: tables.worldEvent.id })
    .from(tables.worldEvent)
    .where(or(
      inArray(tables.worldEvent.status, ["announced", "active"]),
      gt(tables.worldEvent.endedAt, new Date(nowMs - ENDED_LOOKBACK_MS)),
    ));
  let changed = false;
  for (const r of rows) changed = (await worldEventNews(tx, r.id, nowMs)) || changed;
  return changed;
}

/** Laufende Kriege (Diplomatie) und Kartell-Überfälle der letzten 24 Stunden. */
export async function warSituation(tx: Tx, nowMs: number): Promise<{ wars: number; raids: number }> {
  const [w] = await tx
    .select({ n: count() })
    .from(tables.diplomacy)
    .where(and(eq(tables.diplomacy.kind, "krieg"), eq(tables.diplomacy.status, "aktiv"), lte(tables.diplomacy.activeFrom, new Date(nowMs))));
  const [r] = await tx
    .select({ n: count() })
    .from(tables.battleReport)
    .where(and(eq(tables.battleReport.kind, "kartell"), gt(tables.battleReport.createdAt, new Date(nowMs - DAY_MS))));
  return { wars: Number(w?.n ?? 0), raids: Number(r?.n ?? 0) };
}

/** Kriegslage: auf ganze Prozent gerundet, damit nicht jeder Überfall eine neue Nachricht erzeugt. */
async function syncWar(tx: Tx, nowMs: number): Promise<boolean> {
  const cfg = newsBalance()?.war;
  if (!cfg) return false;
  const { wars, raids } = await warSituation(tx, nowMs);
  const pct = Math.round(marketCore.warPct(wars, raids, cfg) * 100) / 100;
  const reason = wars === 0 && raids === 0 ? "Ruhige See – kaum Kämpfe"
    : `Kriegslage: ${wars} ${wars === 1 ? "Krieg" : "Kriege"}, ${raids} Kartell-Überfälle in 24 h`;
  const hold = cfg.holdHours * HOUR_MS;
  return upsertNews(tx, { key: "kriegslage", source: "kriegslage", resource: cfg.resource, pct, reason, startMs: nowMs, endMs: nowMs + hold, fadeMs: hold }, nowMs);
}

/** Saisonende: in den letzten Tagen tageweise steigend (Stahl, Elektronik). */
async function syncSeason(tx: Tx, nowMs: number): Promise<boolean> {
  const cfg = newsBalance()?.seasonEnd;
  if (!cfg) return false;
  const [season] = await tx.select().from(tables.season).where(eq(tables.season.status, "running")).limit(1);
  const endMs = season?.endsAt.getTime() ?? 0;
  const f = season ? marketCore.seasonEndFactor(nowMs, endMs, cfg.days) : 0;
  const daysLeft = Math.max(1, Math.ceil((endMs - nowMs) / DAY_MS));
  let changed = false;
  for (const [resource, full] of Object.entries(cfg.pct)) {
    const pct = Math.round(full * f * 1000) / 1000;
    const reason = `Saisonende in ${daysLeft} ${daysLeft === 1 ? "Tag" : "Tagen"} – die Werften decken sich ein`;
    changed = (await upsertNews(tx, { key: "saison", source: "saison", resource, pct, reason, startMs: nowMs, endMs: nowMs + HOUR_MS, fadeMs: HOUR_MS }, nowMs)) || changed;
  }
  return changed;
}

interface ScarcityState {
  day: number;
  history: Record<string, number[]>;
}

/** Bestände, Kapazität und Netto-Produktion der aktiven Häfen (Spieler in den letzten activeDays Tagen gesehen). */
export async function scarcityInput(tx: Tx, nowMs: number): Promise<Record<string, marketCore.ScarcityBase[]>> {
  const cfg = newsBalance()?.scarcity;
  const out: Record<string, marketCore.ScarcityBase[]> = Object.fromEntries(balance.resources.map((r) => [r, []]));
  if (!cfg) return out;
  const rows = await tx
    .select({ state: tables.base.state })
    .from(tables.base)
    .innerJoin(tables.player, eq(tables.player.id, tables.base.playerId))
    .where(gt(tables.player.lastSeenAt, new Date(nowMs - cfg.activeDays * DAY_MS)));
  for (const row of rows) {
    const state = settle(row.state as BaseState, nowMs, balance);
    const capacity = storageCapacity(state, balance);
    const rates = productionRates(state, balance).perHour;
    for (const r of balance.resources) out[r].push({ stock: state.resources[r] ?? 0, capacity, netPerHour: rates[r] ?? 0 });
  }
  return out;
}

/** Knappheit, einmal je UTC-Tag: Tageswert je Ressource, gleitender Mittelwert über `window` Tage. */
async function syncScarcity(tx: Tx, nowMs: number): Promise<boolean> {
  const cfg = newsBalance()?.scarcity;
  if (!cfg) return false;
  const day = marketCore.gameDayIndex(nowMs);
  const raw = await getSetting(tx, SCARCITY_KEY);
  const prev: ScarcityState = raw ? (JSON.parse(raw) as ScarcityState) : { day: -1, history: {} };
  if (prev.day === day) return false;
  const input = await scarcityInput(tx, nowMs);
  const history: Record<string, number[]> = {};
  let changed = false;
  for (const r of balance.resources) {
    const idx = marketCore.scarcityIndex(input[r], cfg);
    if (idx === null) {
      // Zu wenige aktive Häfen: keine Wirkung, Verlauf beginnt neu.
      history[r] = [];
      changed = (await closeNews(tx, "knappheit", nowMs)) || changed;
      continue;
    }
    history[r] = [...(prev.history[r] ?? []), idx].slice(-Math.max(1, cfg.window));
    const pct = Math.round(marketCore.smoothScarcity(history[r], cfg.window, cfg.max) * 100) / 100;
    const name = RES_NAME[r] ?? r;
    const reason = pct > 0 ? `${name} knapp in den Häfen` : `Volle Lager – ${name} im Überfluss`;
    const spec: NewsSpec = { key: "knappheit", source: "knappheit", resource: r, pct, reason, startMs: nowMs, endMs: nowMs + cfg.holdHours * HOUR_MS, fadeMs: HOUR_MS };
    changed = (await upsertNews(tx, spec, nowMs)) || changed;
  }
  await setSetting(tx, SCARCITY_KEY, JSON.stringify({ day, history }));
  return changed;
}

/**
 * Worker-Job (alle 10 Minuten): Weltereignisse abgleichen, Kriegslage und Saisonende auswerten, einmal täglich die
 * Knappheit, dann den effektiven Versatz fortschreiben und Pushes einsammeln. Rückgabe: geändert und Push-Aufträge.
 */
export async function runMarketNewsTx(db: Db, nowMs: number): Promise<{ changed: boolean; jobs: NoticeJob[]; offsets: Record<string, number> }> {
  if (!newsBalance()) return { changed: false, jobs: [], offsets: {} };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7340003)`);
    let changed = await syncWorldEvents(tx, nowMs);
    changed = (await syncWar(tx, nowMs)) || changed;
    changed = (await syncSeason(tx, nowMs)) || changed;
    changed = (await syncScarcity(tx, nowMs)) || changed;
    const offsets = await persistRefOffsets(tx, nowMs);
    const jobs = await collectNewsPush(tx, nowMs);
    return { changed, jobs, offsets };
  });
}

export async function runMarketNews(engine: Engine, nowMs = Date.now()): Promise<{ changed: boolean; pushed: number }> {
  const r = await runMarketNewsTx(engine.db, nowMs);
  // Der Kurs folgt dem verschobenen Richtwert laufend: Börse alle 10 Minuten neu laden lassen, wenn etwas wirkt.
  const moving = r.changed || Object.values(r.offsets).some((o) => o !== 0);
  afterNewsRun(engine, moving, r.jobs);
  return { changed: r.changed, pushed: r.jobs.length };
}
