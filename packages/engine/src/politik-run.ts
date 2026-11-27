// Weltpolitik, Ablauf: Saisonplan anlegen (Planer, idempotent je Saison) und die Ereignisse politik_start /
// politik_end (Gezeit bzw. Beschluss beginnt/endet: Push „Marktnachricht“, Kursnachricht beim Rohstoffboom) sowie
// seerat_open / seerat_close (Sitzung öffnen: Push an alle aktiven Menschen; schließen: auszählen, Fenster setzen,
// Systemnachricht mit Ergebnis). Regeln: docs/REGELN-WELTPOLITIK.md.
import { and, eq, sql } from "drizzle-orm";
import { planSeed, politikOf, seeratPlan, weltlagePlan, WIRKUNG_TEXT, type FensterEffect } from "@tidefront/game-core";
import { tables, type Db, type Tx } from "@tidefront/db";
import { balance, type Notice, type NoticeJob } from "./context.ts";
import type { Handler, HandlerResult } from "./events.ts";
import { scheduleEvent } from "./store.ts";
import { closeNews, RES_NAME, upsertNews } from "./market-news.ts";
import { activeHumans, invalidatePolitikCache, politikOff, politikSeason } from "./politik-core.ts";
import { tallySitzung } from "./politik-seerat.ts";

const none = (): HandlerResult => ({ notify: [] });

/** Wochentag und Uhrzeit in Spielzeit, z. B. „Mi 14:00“. */
export function whenText(ms: number): string {
  return new Date(ms).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: process.env.TZ || "Europe/Berlin" }).replace(",", "");
}

/** Name einer Wirkung mit Gut (Rohstoffboom: „Rohstoffboom Treibstoff“). */
export function effectName(effect: FensterEffect, good: string | null): string {
  const n = WIRKUNG_TEXT[effect]?.name ?? effect;
  return effect === "rohstoffboom" && good ? `${n} ${RES_NAME[good] ?? good}` : n;
}

/**
 * Planer: legt für die laufende Saison einmal die Gezeit-Fenster, die Wochenfenster (zunächst Ruhige See), die
 * Sitzungen und ihre Ereignisse an. Läuft im Wartungslauf des Workers und beim Start; ein zweiter Lauf tut nichts.
 * Rückgabe: Zahl der angelegten Fenster.
 */
export async function ensurePolitikPlan(db: Db, nowMs: number): Promise<number> {
  if (!politikOf(balance)) return 0;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7340003)`);
    const s = await politikSeason(tx);
    if (!s) return 0;
    const [any] = await tx.select({ id: tables.politikFenster.id }).from(tables.politikFenster).where(eq(tables.politikFenster.seasonId, s.id)).limit(1);
    if (any) return 0;
    const seed = planSeed(s.id, s.startMs);
    const gezeit = weltlagePlan(s.startMs, s.endMs, seed, balance);
    const sitzungen = seeratPlan(s.startMs, s.endMs, gezeit, seed, balance);
    let n = 0;
    for (const g of gezeit) {
      const [w] = await tx.insert(tables.politikFenster).values({
        seasonId: s.id, slot: "gezeit", idx: g.idx, planKind: g.kind, good: g.good, effect: g.kind, source: "plan",
        startsAt: new Date(g.startMs), endsAt: new Date(g.endMs),
      }).returning({ id: tables.politikFenster.id });
      n++;
      await windowEvents(tx, w.id, g.startMs, g.endMs, nowMs);
      const d = sitzungen.find((x) => x.kind === "fenster" && x.idx === g.idx);
      if (d) await insertSitzung(tx, s.id, w.id, d, nowMs);
    }
    for (const d of sitzungen.filter((x) => x.kind === "woche")) {
      const [w] = await tx.insert(tables.politikFenster).values({
        seasonId: s.id, slot: "woche", idx: d.idx, planKind: null, good: null, effect: "ruhig", source: "plan",
        startsAt: new Date(d.effectStartMs), endsAt: new Date(d.effectEndMs),
      }).returning({ id: tables.politikFenster.id });
      n++;
      // Erst die Sitzung (seerat_close), dann das Fenster: gleicher Zeitpunkt, die Auszählung läuft zuerst (kleinere id).
      await insertSitzung(tx, s.id, w.id, d, nowMs);
      await windowEvents(tx, w.id, d.effectStartMs, d.effectEndMs, nowMs);
    }
    invalidatePolitikCache();
    return n;
  });
}

async function windowEvents(tx: Tx, id: number, startMs: number, endMs: number, nowMs: number) {
  if (endMs <= nowMs) return;
  await scheduleEvent(tx, "politik_start", Math.max(startMs, nowMs), { fensterId: id }, null);
  await scheduleEvent(tx, "politik_end", endMs, { fensterId: id }, null);
}

async function insertSitzung(tx: Tx, seasonId: number, fensterId: number, d: { kind: string; opensMs: number; closesMs: number; options: string[] }, nowMs: number) {
  const [row] = await tx.insert(tables.seeratSitzung).values({
    seasonId, fensterId, kind: d.kind, options: d.options, status: "geplant", opensAt: new Date(d.opensMs), closesAt: new Date(d.closesMs),
  }).returning({ id: tables.seeratSitzung.id });
  if (d.closesMs <= nowMs) return;
  await scheduleEvent(tx, "seerat_open", Math.max(d.opensMs, nowMs), { sitzungId: row.id }, null);
  await scheduleEvent(tx, "seerat_close", d.closesMs, { sitzungId: row.id }, null);
}

function notice(title: string, body: string, kind: Notice["kind"], tag: string): Notice {
  return { kind, title, body, url: "/?tab=lage", tag };
}

/** Gezeit oder Beschluss beginnt: Marktnachricht (Boom), Push an aktive Menschen. */
const politikStart: Handler = async (tx, ev, due) => {
  const [w] = await tx.select().from(tables.politikFenster).where(eq(tables.politikFenster.id, Number(ev.payload.fensterId))).for("update");
  if (!w || w.startedAt || w.endsAt.getTime() <= due) return none();
  await tx.update(tables.politikFenster).set({ startedAt: new Date(due) }).where(eq(tables.politikFenster.id, w.id));
  invalidatePolitikCache();
  const effect = w.effect as FensterEffect;
  if (effect === "ruhig" || ((await politikOff(tx)).gezeit && w.slot === "gezeit" && w.source === "plan")) return none();
  const cfg = politikOf(balance)!;
  const name = effectName(effect, w.good);
  const pct = cfg.effects[effect as keyof typeof cfg.effects]?.pricePct;
  if (effect === "rohstoffboom" && w.good && pct) {
    await upsertNews(tx, {
      key: `weltlage:${w.id}`, source: "gezeit", resource: w.good, pct, reason: `Gezeit: ${name}`, startMs: due, endMs: w.endsAt.getTime(), fadeMs: 0,
    }, due);
    // Eigener Push unten; die Marktnachricht soll nicht ein zweites Mal pushen.
    await tx.update(tables.marketNews).set({ pushedAt: new Date(due) }).where(eq(tables.marketNews.key, `weltlage:${w.id}`));
  }
  const label = w.slot === "gezeit" && w.source === "plan" ? "Gezeit" : "Seerat-Beschluss";
  const body = `${WIRKUNG_TEXT[effect].satz} Gilt bis ${whenText(w.endsAt.getTime())}.`;
  const push: NoticeJob[] = (await activeHumans(tx, due)).map((p) => ({ playerId: p.id, notice: notice(`${label}: ${name}`, body, "market", `politik-${w.id}`) }));
  return { notify: [[null, "market"], [null, "base"], [null, "season"]], push };
};

const politikEnd: Handler = async (tx, ev, due) => {
  const id = Number(ev.payload.fensterId);
  await closeNews(tx, `weltlage:${id}`, due);
  invalidatePolitikCache();
  return { notify: [[null, "market"], [null, "base"], [null, "season"]] };
};

const OPTION_TEXT = (o: string, planName: string) => (o === "plan" ? `Gezeit wie geplant (${planName})` : WIRKUNG_TEXT[o as FensterEffect]?.name ?? o);

/** Sitzung öffnet: Push an alle aktiven Menschen (noch hat niemand gewählt). Not-Aus: Sitzung ausgesetzt. */
const seeratOpen: Handler = async (tx, ev, due) => {
  const [s] = await tx.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.id, Number(ev.payload.sitzungId))).for("update");
  if (!s || s.status !== "geplant") return none();
  if ((await politikOff(tx)).seerat) {
    await tx.update(tables.seeratSitzung).set({ status: "ausgesetzt" }).where(eq(tables.seeratSitzung.id, s.id));
    return none();
  }
  await tx.update(tables.seeratSitzung).set({ status: "offen" }).where(eq(tables.seeratSitzung.id, s.id));
  const [w] = await tx.select().from(tables.politikFenster).where(eq(tables.politikFenster.id, s.fensterId));
  const planName = w?.planKind ? effectName(w.planKind as FensterEffect, w.good) : "";
  const opts = (s.options as string[]).map((o) => OPTION_TEXT(o, planName)).join(" · ");
  const voters = await tx.select({ playerId: tables.seeratStimme.playerId }).from(tables.seeratStimme).where(eq(tables.seeratStimme.sitzungId, s.id));
  const voted = new Set(voters.map((v) => v.playerId));
  const push: NoticeJob[] = (await activeHumans(tx, due)).filter((p) => !voted.has(p.id))
    .map((p) => ({ playerId: p.id, notice: notice("Der Seerat tagt", `Abstimmung bis ${whenText(s.closesAt.getTime())}: ${opts}.`, "daily", `seerat-${s.id}`) }));
  return { notify: [[null, "season"]], push };
};

/** Sitzung schließt: auszählen, Ergebnis ins Fenster, Systemnachricht an alle Spieler mit Hafen. */
const seeratClose: Handler = async (tx, ev, due) => {
  const [s] = await tx.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.id, Number(ev.payload.sitzungId))).for("update");
  if (!s || (s.status !== "offen" && s.status !== "geplant")) return none();
  const [w] = await tx.select().from(tables.politikFenster).where(eq(tables.politikFenster.id, s.fensterId)).for("update");
  if (!w) return none();
  const tally = await tallySitzung(tx, s, due);
  const result = tally.winner;
  const effect: FensterEffect = result === "plan" ? ((w.planKind as FensterEffect | null) ?? "ruhig") : (result as FensterEffect);
  await tx.update(tables.seeratSitzung).set({ status: "geschlossen", result, tally }).where(eq(tables.seeratSitzung.id, s.id));
  const source = result === "plan" ? "plan" : "seerat";
  await tx.update(tables.politikFenster).set({ effect, source }).where(and(eq(tables.politikFenster.id, w.id), sql`${tables.politikFenster.source} <> 'admin'`));
  invalidatePolitikCache();
  const name = effectName(effect, w.good);
  const counts = Object.entries(tally.humanVotes).map(([o, n]) => `${OPTION_TEXT(o, effectName((w.planKind ?? "ruhig") as FensterEffect, w.good))}: ${n}`).join(", ") || "keine";
  const ki = tally.kiVotes.map((k) => `${k.name} (${k.profile === "haendler" ? "Händler" : k.profile === "festung" ? "Festung" : "Freibeuter"}) stimmt für ${OPTION_TEXT(k.option, effectName((w.planKind ?? "ruhig") as FensterEffect, w.good))}`).join("; ");
  const lines = [
    `Der Seerat hat entschieden: ${name} (${whenText(w.startsAt.getTime())} bis ${whenText(w.endsAt.getTime())}).`,
    tally.quorumMet ? `Stimmen der Kapitäne: ${counts} (${tally.voted} von mindestens ${tally.quorum} nötigen).` : `Zu wenige Stimmen (${tally.voted} von ${tally.quorum} nötigen) – es gilt der Plan.`,
    ...(ki ? [`KI-Spieler (zusammen eine Stimme): ${ki}.`] : []),
  ];
  const ids = (await tx.selectDistinct({ id: tables.base.playerId }).from(tables.base)).map((r) => r.id);
  if (ids.length > 0) {
    await tx.insert(tables.message).values(ids.map((id) => ({ fromPlayerId: null, toPlayerId: id, subject: `Seerat: ${name}`, body: lines.join("\n"), createdAt: new Date(due) })));
  }
  return { notify: [[null, "season"], [null, "messages"], [null, "market"]] };
};

export const POLITIK_HANDLERS: Record<string, Handler> = {
  politik_start: politikStart,
  politik_end: politikEnd,
  seerat_open: seeratOpen,
  seerat_close: seeratClose,
};
