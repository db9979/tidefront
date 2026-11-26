// Saison: Anlegen, Ende als Ereignis season_end (Endstand, Auszeichnungen, Systemnachrichten, Reset der Welt).
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { market as marketCore } from "@tidefront/game-core";
import { tables, type Db, type DbOrTx, type Tx } from "@tidefront/db";
import { marketBalance } from "./context.ts";
import type { Handler, HandlerResult } from "./events.ts";
import { awardsFor, computeStandings } from "./scoring.ts";
import { scheduleEvent } from "./store.ts";

const DAY_MS = 86400000;

/** Saisonlänge in Tagen aus SEASON_DAYS (Vorgabe 28). */
export function seasonDays(raw = process.env.SEASON_DAYS): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 28;
}

export interface SeasonRow {
  id: number;
  number: number;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

export async function runningSeason(db: DbOrTx): Promise<SeasonRow | null> {
  const [s] = await db
    .select()
    .from(tables.season)
    .where(eq(tables.season.status, "running"))
    .orderBy(desc(tables.season.number))
    .limit(1);
  return s ?? null;
}

/** Legt eine neue Saison an und plant ihr Ende. */
async function openSeason(tx: DbOrTx, number: number, startMs: number): Promise<SeasonRow> {
  const [s] = await tx
    .insert(tables.season)
    .values({ number, startsAt: new Date(startMs), endsAt: new Date(startMs + seasonDays() * DAY_MS), status: "running" })
    .returning();
  await scheduleEvent(tx, "season_end", s.endsAt.getTime(), { seasonId: s.id }, null);
  return s;
}

/** Beim migrate: Saison anlegen, falls keine läuft (Start = jetzt). Idempotent. */
export async function ensureSeason(db: Db, nowMs: number): Promise<SeasonRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7340001)`);
    const running = await runningSeason(tx);
    if (running) return running;
    const [m] = await tx.select({ n: sql<number>`coalesce(max(${tables.season.number}), 0)::int` }).from(tables.season);
    return openSeason(tx, (m?.n ?? 0) + 1, nowMs);
  });
}

const AWARD_TEXT: Record<string, string> = {
  gold: "Gold (Platz 1)",
  silber: "Silber (Platz 2)",
  bronze: "Bronze (Platz 3)",
  best_ausbau: "Bester Ausbau",
  best_militaer: "Stärkstes Militär",
  best_kampf: "Bester Kämpfer",
  best_beute: "Größte Beute",
};

export function awardText(a: string): string {
  return AWARD_TEXT[a] ?? a;
}

/** Journal schließen: offene Salden von Spielern und Lieferungen gegen das Konto season:<n> ausbuchen. */
async function closeLedger(tx: Tx, number: number, atMs: number): Promise<void> {
  const open = await tx.execute<{ account: string; asset: string; sum: string }>(sql`
    select account, asset, sum(amount)::text as sum from trade_ledger
    where account like 'player:%' or account like 'delivery:%'
    group by account, asset having sum(amount) <> 0`);
  if (open.length === 0) return;
  const rows = open.flatMap((o) => {
    const tradeId = `season-${number}-close:${o.account}`;
    const amount = Number(o.sum);
    return [
      { tradeId, tMs: atMs, account: o.account, asset: o.asset, amount: (-amount).toFixed(2) },
      { tradeId, tMs: atMs, account: `season:${number}`, asset: o.asset, amount: amount.toFixed(2) },
    ];
  });
  for (let i = 0; i < rows.length; i += 500) await tx.insert(tables.tradeLedger).values(rows.slice(i, i + 500));
}

/**
 * Saisonende. Läuft in der Transaktion des Ereignisses; ein zweiter Lauf für dieselbe Saison tut nichts.
 * Spieler, Nachrichten, season_result und das Journal bleiben; alles andere der Welt wird zurückgesetzt.
 */
export const seasonEnd: Handler = async (tx, ev, due) => {
  const seasonId = Number(ev.payload.seasonId);
  const [s] = await tx.select().from(tables.season).where(eq(tables.season.id, seasonId)).for("update");
  if (!s || s.status !== "running") return { notify: [] };

  // 1. Endstand und Auszeichnungen.
  const standings = await computeStandings(tx, s.startsAt.getTime(), due);
  const ranked = standings.filter((r) => r.base !== null || r.total > 0);
  const awards = awardsFor(ranked);
  if (ranked.length > 0) {
    await tx
      .insert(tables.seasonResult)
      .values(ranked.map((r) => ({
        seasonId: s.id, playerId: r.playerId, playerName: r.name, rank: r.rank, ausbau: r.ausbau,
        militaer: r.militaer, kampf: r.kampf, beute: r.beute, total: r.total, awards: awards.get(r.playerId) ?? [],
      })))
      .onConflictDoNothing();
  }

  // 2. Systemnachricht an alle Spieler.
  const winner = ranked[0];
  const byId = new Map(ranked.map((r) => [r.playerId, r]));
  if (standings.length > 0) {
    await tx.insert(tables.message).values(standings.map((p) => {
      const own = byId.get(p.playerId);
      const lines = [`Saison ${s.number} ist beendet.`];
      if (winner && winner.total > 0) lines.push(`Sieger: ${winner.name} mit ${winner.total} Punkten.`);
      if (own) {
        lines.push(`Dein Platz: ${own.rank} von ${ranked.length} mit ${own.total} Punkten ` +
          `(Ausbau ${own.ausbau}, Militär ${own.militaer}, Kampf ${own.kampf}, Beute ${own.beute}).`);
        const a = awards.get(p.playerId) ?? [];
        if (a.length > 0) lines.push(`Deine Auszeichnungen: ${a.map(awardText).join(", ")}.`);
      } else lines.push("Du warst in dieser Saison nicht platziert.");
      lines.push(`Saison ${s.number + 1} beginnt jetzt. Wähle einen neuen Hafen.`);
      return { fromPlayerId: null, toPlayerId: p.playerId, subject: `Saison ${s.number}: Endstand`, body: lines.join("\n"), createdAt: new Date(due) };
    }));
  }

  // 3. Journal abschließen (Kredite und Lieferungen auf 0), dann die Welt zurücksetzen.
  await closeLedger(tx, s.number, due);
  await tx.delete(tables.delivery);
  await tx.delete(tables.mission);
  await tx.delete(tables.wreck);
  await tx.delete(tables.battleReport);
  await tx.delete(tables.commandLog);
  await tx
    .delete(tables.gameEvent)
    .where(and(eq(tables.gameEvent.status, "pending"), sql`${tables.gameEvent.type} <> 'season_end'`));
  await tx.delete(tables.base);
  await tx.update(tables.nest).set({ defeatedAt: null });
  const market = marketCore.createMarketState(marketBalance, due);
  for (const [resource, state] of Object.entries(market)) {
    await tx
      .insert(tables.market)
      .values({ resource, state })
      .onConflictDoUpdate({ target: tables.market.resource, set: { state } });
  }
  const { stock: _stock, ...trader } = marketCore.createTraderState(marketBalance, 0, {}, due);
  await tx.update(tables.player).set({ trader });

  // 4. Saison abschließen, neue Saison anlegen.
  await tx.update(tables.season).set({ status: "finished", finishedAt: new Date(due) }).where(eq(tables.season.id, s.id));
  await openSeason(tx, s.number + 1, due);

  const notify: HandlerResult["notify"] = [
    [null, "season"], [null, "messages"], [null, "base"], [null, "map"], [null, "reports"], [null, "market"],
  ];
  return { notify };
};

// ---------------------------------------------------------------- Lesemodelle

export interface OwnResult {
  seasonNumber: number;
  rank: number;
  of: number;
  total: number;
  awards: string[];
}

/** Laufende Saison und eigenes Ergebnis der letzten beendeten Saison. */
export async function seasonView(db: DbOrTx, playerId: number) {
  const nowMs = Date.now();
  const s = await runningSeason(db);
  const [last] = await db
    .select()
    .from(tables.season)
    .where(eq(tables.season.status, "finished"))
    .orderBy(desc(tables.season.number))
    .limit(1);
  let lastResult: OwnResult | null = null;
  if (last) {
    const rows = await db
      .select({ playerId: tables.seasonResult.playerId, rank: tables.seasonResult.rank, total: tables.seasonResult.total, awards: tables.seasonResult.awards })
      .from(tables.seasonResult)
      .where(eq(tables.seasonResult.seasonId, last.id));
    const own = rows.find((r) => r.playerId === playerId);
    if (own) lastResult = { seasonNumber: last.number, rank: own.rank, of: rows.length, total: own.total, awards: own.awards as string[] };
  }
  return {
    serverNow: nowMs,
    season: s ? { number: s.number, startsAtMs: s.startsAt.getTime(), endsAtMs: s.endsAt.getTime() } : null,
    lastSeason: last ? { number: last.number, finishedAtMs: (last.finishedAt ?? last.endsAt).getTime() } : null,
    lastResult,
  };
}

/** Ruhmeshalle: beendete Saisons mit Podium, Kategoriebesten und eigenem Ergebnis. */
export async function hallOfFame(db: DbOrTx, playerId: number) {
  const seasons = await db
    .select()
    .from(tables.season)
    .where(eq(tables.season.status, "finished"))
    .orderBy(desc(tables.season.number))
    .limit(50);
  if (seasons.length === 0) return [];
  const results = await db
    .select()
    .from(tables.seasonResult)
    .where(inArray(tables.seasonResult.seasonId, seasons.map((s) => s.id)))
    .orderBy(tables.seasonResult.rank);
  return seasons.map((s) => {
    const rows = results.filter((r) => r.seasonId === s.id);
    const pick = (r: (typeof rows)[number]) => ({ playerId: r.playerId, name: r.playerName, rank: r.rank, total: r.total, awards: r.awards as string[] });
    const best = (a: string) => rows.find((r) => (r.awards as string[]).includes(a));
    const own = rows.find((r) => r.playerId === playerId);
    return {
      number: s.number,
      startsAtMs: s.startsAt.getTime(),
      finishedAtMs: (s.finishedAt ?? s.endsAt).getTime(),
      players: rows.length,
      podium: rows.filter((r) => r.rank <= 3 && r.total > 0).map(pick),
      best: Object.fromEntries(
        ["best_ausbau", "best_militaer", "best_kampf", "best_beute"].map((a) => {
          const r = best(a);
          return [a, r ? { name: r.playerName, value: r[a.slice(5) as "ausbau"] } : null];
        }),
      ) as Record<string, { name: string; value: number } | null>,
      own: own ? { ...pick(own), ausbau: own.ausbau, militaer: own.militaer, kampf: own.kampf, beute: own.beute } : null,
    };
  });
}
