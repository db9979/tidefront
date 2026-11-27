// Weltpolitik: Lesemodelle für die Oberfläche (tRPC politik.*) und die Verwaltung. Die Oberfläche folgt nach dem
// Navigationsumbau; die Schnittstelle liefert alles, was Streifen, Blatt „Gezeit & Seerat“ und die KI-Karten brauchen.
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  nextChangeMs, politikLimitMs, politikNow, politikOf, WIRKUNG_TEXT, type FensterEffect, type PolitikPlan, type PolitikWindow,
} from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { setSetting } from "./settings.ts";
import { invalidatePolitikCache, POLITIK_OFF, politikKis, politikOff, politikSeason, PROFILE_TEXT, seasonPlan, type PolitikPart } from "./politik-core.ts";
import { ansehenAll, kiAccess, notoriousOf } from "./politik-ansehen.ts";
import { gesucheOf, settleGesuche } from "./politik-gesuche.ts";
import { ownVotes, tallySitzung, voteCount } from "./politik-seerat.ts";
import { effectName, whenText } from "./politik-run.ts";
import { RES_NAME } from "./market-news.ts";

const HOUR_MS = 3_600_000;
const pct = (x: number) => `${Math.round(x * 1000) / 10} %`.replace(".", ",");

function windowView(w: PolitikWindow, nowMs: number) {
  const announce = (politikOf(balance)?.gezeit.announceHours ?? 24) * HOUR_MS;
  return {
    id: w.id, slot: w.slot, idx: w.idx, startMs: w.startMs, endMs: w.endMs, source: w.source,
    planKind: w.planKind, planName: w.planKind ? effectName(w.planKind, w.good) : null, good: w.good,
    effect: w.effect, name: effectName(w.effect, w.good), satz: WIRKUNG_TEXT[w.effect]?.satz ?? "",
    active: w.effect !== "ruhig" && w.startMs <= nowMs && nowMs < w.endMs,
    /** Angekündigt (24 h vorher) oder schon vorbei/laufend. */
    announced: nowMs >= w.startMs - announce,
  };
}

/** Aufschlüsselung der wirkenden Regler: „Gebühr 6 % gilt bis Mi 14:00 – danach 4 %“. */
export function effectLines(plan: PolitikPlan, nowMs: number): string[] {
  const n = politikNow(balance, plan, nowMs);
  if (!n) return [];
  const until = nextChangeMs(plan, nowMs);
  const bis = until ? ` gilt bis ${whenText(until)}` : "";
  const out: string[] = [];
  const base = balance.market;
  if (n.fee !== 1) out.push(`Börsengebühr ${pct(base.fee * n.fee)}${bis} – danach ${pct(base.fee)}`);
  if (n.dailyLimit !== 1) out.push(`Tageslimit ${pct(base.dailyLimitShareOfStorage * n.dailyLimit)} des Lagers${bis} – danach ${pct(base.dailyLimitShareOfStorage)}`);
  if (n.kiBonus !== 0) out.push(`Vertragsbonus der KI-Spieler ${n.kiBonus > 0 ? "+" : "−"}${pct(Math.abs(n.kiBonus))}${bis}`);
  for (const [r, f] of Object.entries(n.production)) out.push(`${RES_NAME[r] ?? r}: Produktion und Feldertrag +${pct(f - 1)}${bis}`);
  if (n.raidInterval !== 1) out.push(`Kartell-Überfälle alle ${Math.round(balance.pirates.raidIntervalHours * n.raidInterval)} h statt ${balance.pirates.raidIntervalHours} h${bis}`);
  if (n.fieldCartelChance !== 1) out.push(`Kartell-Angriffe auf Felder × ${String(n.fieldCartelChance).replace(".", ",")}${bis}`);
  if (n.convoyCartelChance !== 1) out.push(`Kartellchance für Konvois × ${String(n.convoyCartelChance).replace(".", ",")}${bis}`);
  if (n.playerTradeFee !== 1) out.push(`Gebühr im Spielerhandel × ${String(n.playerTradeFee).replace(".", ",")}${bis}`);
  if (n.contractFee !== 1) out.push(`Vertragsgebühr × ${String(n.contractFee).replace(".", ",")}${bis}`);
  if (n.worldEventLoot !== 1) out.push(`Neue Weltereignisse: Beute +${pct(n.worldEventLoot - 1)}${bis}`);
  for (const [k, f] of Object.entries(n.kindWeights)) out.push(`Weltereignis ${k}: Gewicht × ${f}${bis}`);
  return out;
}

const optionView = (o: string, w: PolitikWindow | undefined) => ({
  key: o,
  name: o === "plan" ? `Gezeit wie geplant: ${w?.planKind ? effectName(w.planKind, w.good) : "–"}` : WIRKUNG_TEXT[o as FensterEffect]?.name ?? o,
  satz: o === "plan" ? (w?.planKind ? WIRKUNG_TEXT[w.planKind].satz : "") : WIRKUNG_TEXT[o as FensterEffect]?.satz ?? "",
});

/** Saisonkalender, wirkende Regler und Seerat (eigene Stimme, nach dem Schluss Ergebnis ohne Namen). */
export async function politikOverview(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const db = engine.db;
  const s = await politikSeason(db);
  const off = await politikOff(db);
  const plan = await seasonPlan(db);
  const sessions = s ? await db.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.seasonId, s.id)).orderBy(tables.seeratSitzung.opensAt) : [];
  const mine = await ownVotes(db, playerId, sessions.map((x) => x.id));
  const byId = new Map(plan.windows.map((w) => [w.id, w]));
  const seerat = [];
  for (const x of sessions) {
    const w = byId.get(x.fensterId);
    const open = x.opensAt.getTime() <= nowMs && nowMs < x.closesAt.getTime() && (x.status === "offen" || x.status === "geplant");
    seerat.push({
      id: x.id, kind: x.kind as "fenster" | "woche", fensterId: x.fensterId, status: open ? "offen" : x.status,
      opensMs: x.opensAt.getTime(), closesMs: x.closesAt.getTime(), effectStartMs: w?.startMs ?? null, effectEndMs: w?.endMs ?? null,
      options: (x.options as string[]).map((o) => optionView(o, w)),
      myVote: mine.get(x.id) ?? null,
      votes: open ? await voteCount(db, x.id) : null,
      result: x.result, tally: x.status === "geschlossen" ? x.tally : null,
    });
  }
  return {
    serverNow: nowMs,
    enabled: !!politikOf(balance),
    off,
    season: s ? { startMs: s.startMs, endMs: s.endMs, limitMs: politikLimitMs(s.startMs, s.endMs, balance) } : null,
    windows: plan.windows.map((w) => windowView(w, nowMs)),
    lines: effectLines(plan, nowMs),
    nextChangeMs: nextChangeMs(plan, nowMs),
    seerat,
  };
}

/** Ansehen bei jedem KI-Spieler (Stufe, Wirkung, letzte 10 Buchungen) und die eigenen Gesuche der Saison. */
export async function politikKiView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const s = await politikSeason(engine.db);
  return engine.db.transaction(async (tx) => {
    await settleGesuche(tx, nowMs, playerId);
    const kis = await politikKis(tx);
    const all = await ansehenAll(tx, playerId, nowMs, kis.map((k) => k.id));
    const names = new Map(kis.map((k) => [k.id, k]));
    const cards = [];
    for (const k of kis) {
      const a = await kiAccess(tx, k, playerId, nowMs, all);
      const st = all.get(k.id);
      cards.push({
        id: k.id, name: k.name, profile: k.profile, profileText: PROFILE_TEXT[k.profile] ?? k.profile,
        value: a.value, level: a.level, refuses: a.refuses, reason: a.reason, bonusDelta: a.bonusDelta, quotaShare: a.quotaShare,
        gesuche: a.gesuche, pakt: a.pakt, history: (st?.history ?? []).slice(-10).reverse(),
      });
    }
    const rows = s ? await gesucheOf(tx, playerId, s.id) : [];
    return {
      serverNow: nowMs,
      notorious: await notoriousOf(tx, playerId, nowMs, all),
      kis: cards,
      gesuche: rows.map((g) => ({
        id: g.id, kiId: g.kiId, kiName: names.get(g.kiId)?.name ?? "?", profileText: PROFILE_TEXT[names.get(g.kiId)?.profile ?? ""] ?? "",
        kind: g.kind, status: g.status, day: g.day, resource: g.resource, qty: g.qty, reward: g.reward as Record<string, number>, value: g.value,
        offeredMs: g.offeredAt.getTime(), expiresMs: g.expiresAt.getTime(), acceptedMs: g.acceptedAt?.getTime() ?? null,
        closedMs: g.closedAt?.getTime() ?? null, contractId: g.contractId,
      })),
    };
  });
}

/** Plan für `meta`: alle Fenster der Saison und wann sich die wirksame Balance das nächste Mal ändert. */
export async function politikMeta(db: DbOrTx) {
  const plan = await seasonPlan(db);
  const nowMs = Date.now();
  return { plan, validUntilMs: nextChangeMs(plan, nowMs) };
}

// ---------------------------------------------------------------- Verwaltung

/** Verwaltung: Plan, Sitzungen mit Zwischenstand, Zähler der Gesuche, Not-Aus. */
export async function politikAdminView(engine: Engine) {
  const nowMs = Date.now();
  const db = engine.db;
  const s = await politikSeason(db);
  const plan = await seasonPlan(db);
  const sessions = s ? await db.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.seasonId, s.id)).orderBy(tables.seeratSitzung.opensAt) : [];
  const counts = s ? await db.select({ status: tables.kiGesuch.status, n: sql<number>`count(*)::int` }).from(tables.kiGesuch)
    .where(eq(tables.kiGesuch.seasonId, s.id)).groupBy(tables.kiGesuch.status) : [];
  const tallies = [];
  for (const x of sessions) tallies.push({ id: x.id, kind: x.kind, status: x.status, opensMs: x.opensAt.getTime(), closesMs: x.closesAt.getTime(), result: x.result, tally: x.tally ?? (x.status === "offen" ? await tallySitzung(db, x, nowMs) : null) });
  return {
    serverNow: nowMs, off: await politikOff(db), windows: plan.windows.map((w) => windowView(w, nowMs)), lines: effectLines(plan, nowMs),
    sessions: tallies, gesuche: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  };
}

/** Not-Aus je Baustein (gezeit, seerat, gesuche). */
export async function setPolitikOff(engine: Engine, part: PolitikPart, isOff: boolean) {
  await setSetting(engine.db, POLITIK_OFF[part], isOff ? "1" : "0");
  invalidatePolitikCache();
  engine.notify(null, "season");
  return { ok: true as const };
}

/** Fenster absagen (Ruhige See, Quelle admin; der Seerat überschreibt es nicht mehr). Code: no_window. */
export async function cancelPolitikWindow(engine: Engine, fensterId: number) {
  const nowMs = Date.now();
  const r = await engine.db.update(tables.politikFenster).set({ effect: "ruhig", source: "admin" })
    .where(and(eq(tables.politikFenster.id, fensterId), sql`${tables.politikFenster.endsAt} > ${new Date(nowMs).toISOString()}::timestamptz`)).returning({ id: tables.politikFenster.id });
  if (r.length === 0) throw new GameError("no_window");
  await engine.db.update(tables.marketNews).set({ endsAt: new Date(nowMs), fadeMinutes: 0 })
    .where(and(inArray(tables.marketNews.key, [`weltlage:${fensterId}`]), sql`${tables.marketNews.endsAt} > now()`));
  invalidatePolitikCache();
  engine.notify(null, "market");
  return { ok: true as const };
}
