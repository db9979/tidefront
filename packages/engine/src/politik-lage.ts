// Weltpolitik im Lagezentrum (lage.ts): Gezeit/Beschluss (Ankündigung 24 h vorher, Ende), offene Seerat-Sitzung ohne
// eigene Stimme, Gesuche (angeboten: wartet auf dich; angenommen: unterwegs bis zur Fälligkeit des Vertrags) und
// Ansehensänderungen (Stufe in den letzten 24 h gewechselt).
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { ansehenLevel, politikOf, WIRKUNG_TEXT, type AnsehenLevel } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { fmtInt, nameOf } from "./names.ts";
import { row, SOON_MS, type LageRow } from "./lage-types.ts";
import { politikKis, politikSeason, seasonPlan } from "./politik-core.ts";
import { ansehenAll } from "./politik-ansehen.ts";
import { effectName, whenText } from "./politik-run.ts";

const LEVEL_TEXT: Record<AnsehenLevel, string> = { misstraut: "Misstraut", bekannt: "Bekannt", vertraut: "Vertraut" };

export interface PolitikLage {
  soon: LageRow[];
  underway: LageRow[];
  waiting: LageRow[];
}

export async function politikLage(db: DbOrTx, playerId: number, nowMs: number): Promise<PolitikLage> {
  const out: PolitikLage = { soon: [], underway: [], waiting: [] };
  const cfg = politikOf(balance);
  const s = await politikSeason(db);
  if (!cfg || !s) return out;
  const plan = await seasonPlan(db);
  for (const w of plan.windows) {
    if (w.effect === "ruhig" || w.endMs <= nowMs) continue;
    const label = w.slot === "gezeit" && w.source === "plan" ? "Gezeit" : "Seerat-Beschluss";
    const name = `${label}: ${effectName(w.effect, w.good)}`;
    if (nowMs < w.startMs && w.startMs - nowMs <= cfg.gezeit.announceHours * 3_600_000) {
      out.soon.push(row({ key: `politik:${w.id}:start`, kind: "gezeit", atMs: w.startMs, icon: "wind", text: `${name} beginnt`, sub: WIRKUNG_TEXT[w.effect].satz }));
    } else if (w.startMs <= nowMs) {
      out.soon.push(row({ key: `politik:${w.id}:ende`, kind: "gezeit", atMs: w.endMs, icon: "wind", text: `${name} endet`, sub: `Gilt bis ${whenText(w.endMs)} · ${WIRKUNG_TEXT[w.effect].satz}` }));
    }
  }
  // Seerat: offene Sitzungen ohne eigene Stimme.
  const t = tables.seeratSitzung;
  const open = await db.select().from(t).where(and(eq(t.seasonId, s.id), lte(t.opensAt, new Date(nowMs)), gt(t.closesAt, new Date(nowMs)), inArray(t.status, ["offen", "geplant"])));
  if (open.length > 0) {
    const voted = new Set((await db.select({ id: tables.seeratStimme.sitzungId }).from(tables.seeratStimme)
      .where(and(eq(tables.seeratStimme.playerId, playerId), inArray(tables.seeratStimme.sitzungId, open.map((x) => x.id))))).map((r) => r.id));
    for (const x of open) {
      if (voted.has(x.id)) continue;
      const r = { key: `seerat:${x.id}`, kind: "seerat", icon: "anker", text: "Der Seerat tagt – stimme ab", sub: `Abstimmung bis ${whenText(x.closesAt.getTime())}` };
      out.waiting.push(row(r));
      out.soon.push(row({ ...r, key: `seerat:${x.id}:schluss`, atMs: x.closesAt.getTime(), text: "Seerat: Abstimmung endet" }));
    }
  }
  // Gesuche.
  const g = tables.kiGesuch;
  const rows = await db.select().from(g).where(and(eq(g.seasonId, s.id), eq(g.playerId, playerId), inArray(g.status, ["angeboten", "angenommen"])));
  const kis = new Map((await politikKis(db)).map((k) => [k.id, k]));
  for (const r of rows) {
    const who = kis.get(r.kiId)?.name ?? "KI-Spieler";
    const what = `${fmtInt(r.qty)} ${nameOf(r.resource)}`;
    if (r.status === "angeboten") {
      out.waiting.push(row({ key: `gesuch:${r.id}`, kind: "gesuch", atMs: r.expiresAt.getTime(), icon: r.resource, text: `Gesuch von ${who}: liefere ${what}`, sub: `Angebot gilt bis ${whenText(r.expiresAt.getTime())}`, jump: { to: "contracts" } }));
    } else {
      const [c] = r.contractId ? await db.select({ dueAt: tables.marketContract.dueAt }).from(tables.marketContract).where(eq(tables.marketContract.id, r.contractId)) : [];
      const due = c?.dueAt.getTime() ?? null;
      out.underway.push(row({ key: `gesuch-weg:${r.id}`, kind: "gesuch", atMs: due, icon: r.resource, text: `Gesuch für ${who}: ${what}`, sub: "Lohn bei Erfüllung des Vertrags", progress: due && r.acceptedAt ? { fromMs: r.acceptedAt.getTime(), toMs: due } : null, jump: { to: "contracts" } }));
    }
  }
  // Ansehen: Stufe in den letzten 24 h gewechselt.
  const all = await ansehenAll(db, playerId, nowMs, [...kis.keys()]);
  for (const [kiId, st] of all) {
    const before = [...st.history].reverse().find((h) => h.atMs <= nowMs - SOON_MS)?.value ?? 0;
    const was = ansehenLevel(before, cfg.ansehen);
    if (was === st.level || !st.history.some((h) => h.atMs > nowMs - SOON_MS)) continue;
    out.waiting.push(row({ key: `ansehen:${kiId}:${st.level}`, kind: "ansehen", icon: "anker", text: `Ansehen bei ${kis.get(kiId)?.name ?? "?"}: ${LEVEL_TEXT[st.level]}`, sub: `vorher ${LEVEL_TEXT[was]} · Stand ${Math.round(st.value)}`, tone: st.level === "misstraut" ? "alarm" : st.level === "vertraut" ? "gut" : null, jump: { to: "contracts" } }));
  }
  return out;
}
