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
import { effectName } from "./politik-run.ts";
import { kiPaktOffers } from "./politik-pakt.ts";
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

/** Eine wirkende Verschiebung: Schlüssel (für die Stelle, an der sie wirkt), Text jetzt, Ende, Wert danach. */
export interface EffectLine {
  key: "fee" | "dailyLimit" | "kiBonus" | "production" | "raidInterval" | "fieldCartelChance" | "convoyCartelChance" | "playerTradeFee" | "contractFee" | "worldEventLoot" | "kindWeights";
  text: string;
  /** Nächster Wechsel der wirksamen Balance (Ende des Fensters), null ohne Ende. */
  untilMs: number | null;
  /** Wert danach („4 %“), null wenn nicht sinnvoll. */
  after: string | null;
}

/** Aufschlüsselung der wirkenden Regler: „Börsengebühr 6 %“ bis … – danach 4 %. */
export function effectLines(plan: PolitikPlan, nowMs: number): EffectLine[] {
  const n = politikNow(balance, plan, nowMs);
  if (!n) return [];
  const untilMs = nextChangeMs(plan, nowMs);
  const out: EffectLine[] = [];
  const add = (key: EffectLine["key"], text: string, after: string | null = null) => out.push({ key, text, untilMs, after });
  const x = (f: number) => `× ${String(Math.round(f * 100) / 100).replace(".", ",")}`;
  const base = balance.market;
  if (n.fee !== 1) add("fee", `Börsengebühr ${pct(base.fee * n.fee)}`, pct(base.fee));
  if (n.dailyLimit !== 1) add("dailyLimit", `Tageslimit ${pct(base.dailyLimitShareOfStorage * n.dailyLimit)} des Lagers`, pct(base.dailyLimitShareOfStorage));
  if (n.kiBonus !== 0) add("kiBonus", `Vertragsbonus der KI-Spieler ${n.kiBonus > 0 ? "+" : "−"}${pct(Math.abs(n.kiBonus))}`);
  for (const [r, f] of Object.entries(n.production)) add("production", `${RES_NAME[r] ?? r}: Produktion und Feldertrag +${pct(f - 1)}`);
  if (n.raidInterval !== 1) add("raidInterval", `Kartell-Überfälle alle ${Math.round(balance.pirates.raidIntervalHours * n.raidInterval)} h`, `${balance.pirates.raidIntervalHours} h`);
  if (n.fieldCartelChance !== 1) add("fieldCartelChance", `Kartell-Angriffe auf Felder ${x(n.fieldCartelChance)}`);
  if (n.convoyCartelChance !== 1) add("convoyCartelChance", `Kartellchance für Konvois ${x(n.convoyCartelChance)}`);
  if (n.playerTradeFee !== 1) add("playerTradeFee", `Gebühr im Spielerhandel ${x(n.playerTradeFee)}`);
  if (n.contractFee !== 1) add("contractFee", `Vertragsgebühr der KI-Verträge ${x(n.contractFee)}`);
  if (n.worldEventLoot !== 1) add("worldEventLoot", `Neue Weltereignisse: Beute +${pct(n.worldEventLoot - 1)}`);
  for (const [k, f] of Object.entries(n.kindWeights)) add("kindWeights", `Weltereignis ${KIND_NAME[k] ?? k} häufiger (${x(f)})`);
  return out;
}

const KIND_NAME: Record<string, string> = { schatzschiff: "Schatzschiff", grossflotte: "Großflotte", belagerung: "Belagerung" };

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
    /** Offene Paktangebote der KI-Spieler an dich (Annehmen/Ablehnen: politik.acceptPakt / declinePakt). */
    pakte: await kiPaktOffers(db, playerId),
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
        gesuche: a.gesuche, pakt: a.pakt, blockedUntilMs: a.blockedUntilMs, history: (st?.history ?? []).slice(-10).reverse(),
      });
    }
    const rows = s ? await gesucheOf(tx, playerId, s.id) : [];
    const cids = rows.map((g) => g.contractId).filter((x): x is number => x !== null);
    const dues = new Map(cids.length === 0 ? [] : (await tx.select({ id: tables.marketContract.id, dueAt: tables.marketContract.dueAt }).from(tables.marketContract)
      .where(inArray(tables.marketContract.id, cids))).map((c) => [c.id, c.dueAt.getTime()]));
    return {
      serverNow: nowMs,
      notorious: await notoriousOf(tx, playerId, nowMs, all),
      kis: cards,
      gesuche: rows.map((g) => ({
        id: g.id, kiId: g.kiId, kiName: names.get(g.kiId)?.name ?? "?", profileText: PROFILE_TEXT[names.get(g.kiId)?.profile ?? ""] ?? "",
        kind: g.kind, status: g.status, day: g.day, resource: g.resource, qty: g.qty, reward: g.reward as Record<string, number>, value: g.value,
        offeredMs: g.offeredAt.getTime(), expiresMs: g.expiresAt.getTime(), acceptedMs: g.acceptedAt?.getTime() ?? null,
        closedMs: g.closedAt?.getTime() ?? null, contractId: g.contractId, dueMs: g.contractId !== null ? dues.get(g.contractId) ?? null : null,
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
