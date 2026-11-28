// Weltpolitik: Ansehen je KI-Spieler (docs/REGELN-WELTPOLITIK.md, Abschnitt 3). Kein eigener Zähler: gerechnet beim
// Lesen aus den Zeilen der Saison – KI-Lieferverträge (erfüllt +2, Strafe −10), erfüllte Gesuche (+5), Überfälle auf
// den KI-Spieler (−30, Paktbruch −15) und Merkern (Pakt gekündigt). Ersetzt das Ja/Nein von kiRefuses: kiAccess liefert
// Stufe, Vertragsbonus, Kontingent und ob Händler/Festung ablehnen (Überfall-Sperre 72 h, Berüchtigt).
import { and, eq, gte, inArray, or } from "drizzle-orm";
import { ansehenAt, ansehenEffects, isNotorious, politikOf, type AnsehenEntry, type AnsehenLevel, type AnsehenResult } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { politikKis, politikSeason } from "./politik-core.ts";
import { aechtungUntil, rufOf, rufRules } from "./politik-ruf.ts"; // Stufe 2: globaler Ruf und Ächtung

const HOUR_MS = 3_600_000;

export interface KiStanding extends AnsehenResult {
  kiId: number;
}

/** Ansehen dieses Menschen bei allen (oder den genannten) KI-Spielern zum Zeitpunkt nowMs. */
export async function ansehenAll(db: DbOrTx, humanId: number, nowMs: number, kiIds?: number[]): Promise<Map<number, KiStanding>> {
  const cfg = politikOf(balance)?.ansehen;
  const out = new Map<number, KiStanding>();
  const s = await politikSeason(db);
  const ids = kiIds ?? (await politikKis(db)).map((k) => k.id);
  if (!cfg || !s || ids.length === 0) return out;
  const since = new Date(s.startMs);
  const entries = new Map<number, AnsehenEntry[]>(ids.map((id) => [id, []]));
  const add = (ki: number | null, e: AnsehenEntry) => { if (ki !== null) entries.get(ki)?.push(e); };

  const c = tables.marketContract;
  const contracts = await db.select({ id: c.id, status: c.status, sellerId: c.sellerId, buyerId: c.buyerId, closedAt: c.closedAt, dueAt: c.dueAt,
    buyerPenaltyCents: c.buyerPenaltyCents, sellerPenaltyCents: c.sellerPenaltyCents })
    .from(c).where(and(eq(c.kind, "ki"), gte(c.createdAt, since), or(
      and(eq(c.sellerId, humanId), inArray(c.buyerId, ids)), and(eq(c.buyerId, humanId), inArray(c.sellerId, ids)))));
  for (const r of contracts) {
    const ki = r.sellerId === humanId ? r.buyerId : r.sellerId;
    const at = (r.closedAt ?? r.dueAt).getTime();
    const penalty = r.sellerId === humanId ? r.sellerPenaltyCents : r.buyerPenaltyCents;
    if (r.status === "erfuellt") add(ki, { atMs: at, kind: "vertrag", ref: `vertrag:${r.id}` });
    if (penalty > 0) add(ki, { atMs: at, kind: "strafe", ref: `vertrag:${r.id}` });
  }
  const g = tables.kiGesuch;
  const gesuche = await db.select({ id: g.id, kiId: g.kiId, closedAt: g.closedAt }).from(g)
    .where(and(eq(g.seasonId, s.id), eq(g.playerId, humanId), eq(g.status, "erfuellt"), inArray(g.kiId, ids)));
  for (const r of gesuche) if (r.closedAt) add(r.kiId, { atMs: r.closedAt.getTime(), kind: "gesuch", ref: `gesuch:${r.id}` });
  const br = tables.battleReport;
  const raids = await db.select({ id: br.id, defender: br.defenderPlayerId, createdAt: br.createdAt }).from(br)
    .where(and(eq(br.kind, "ueberfall"), eq(br.attackerPlayerId, humanId), inArray(br.defenderPlayerId, ids), gte(br.createdAt, since)));
  for (const r of raids) add(r.defender, { atMs: r.createdAt.getTime(), kind: "ueberfall", ref: `bericht:${r.id}` });
  const m = tables.ansehenMerker;
  const marks = await db.select().from(m).where(and(eq(m.seasonId, s.id), eq(m.playerId, humanId), inArray(m.kiId, ids)));
  for (const r of marks) add(r.kiId, { atMs: r.atMs, kind: r.kind as AnsehenEntry["kind"], ref: r.ref });

  for (const [ki, list] of entries) out.set(ki, { kiId: ki, ...ansehenAt(list, s.startMs, nowMs, cfg) });
  return out;
}

export interface KiAccess {
  value: number;
  level: AnsehenLevel;
  /** Händler/Festung schließen nichts ab und geben keine Gesuche. */
  refuses: boolean;
  /** Grund der Ablehnung: ueberfall (Sperre nach Überfall), beruechtigt (Ruf ≤ −30) oder aechtung (Seerat, alle KI). */
  reason: "ueberfall" | "beruechtigt" | "aechtung" | null;
  /** Additiv auf den Vertragsbonus dieses KI-Spielers. */
  bonusDelta: number;
  /** Kontingent-Anteil (statt contracts.ki.quotaShare). */
  quotaShare: number | null;
  gesuche: boolean;
  pakt: boolean;
  notorious: boolean;
  /** Ende der Sperre nach einem Überfall (Händler/Festung), sonst null. */
  blockedUntilMs: number | null;
  /** Stufe 2: Ruf „Angesehen“ – Wirkung wie „Vertraut“ bei allen KI-Spielern. */
  angesehen: boolean;
  /** Stufe 2: Ende einer laufenden Ächtung (keine KI-Verträge und Gesuche), sonst null. */
  aechtungUntilMs: number | null;
}

/**
 * Berüchtigt: globaler Ruf ≤ −30 (Stufe 2). Ohne Balance-Block ruf gilt der vorläufige Ersatz von Stufe 1: Mittel des
 * Ansehens über alle aktiven KI-Spieler ≤ notoriousMean.
 */
export async function notoriousOf(db: DbOrTx, humanId: number, nowMs: number, all?: Map<number, KiStanding>): Promise<boolean> {
  const cfg = politikOf(balance)?.ansehen;
  if (!cfg) return false;
  if (rufRules()) return (await rufOf(db, humanId, nowMs))?.level === "beruechtigt";
  const map = all ?? (await ansehenAll(db, humanId, nowMs));
  return isNotorious([...map.values()].map((x) => x.value), map.size, cfg);
}

/**
 * Zugang dieses Menschen zu einem KI-Spieler (ersetzt kiRefuses). Freibeuter lehnt nie ab – außer bei einer Ächtung.
 * Stufe 2: Ruf „Angesehen“ wirkt wie „Vertraut“ (Bonus, Kontingent, Pakt); Berüchtigt (Ruf ≤ −30): Händler und Festung
 * schließen nichts ab; Ächtung: kein KI-Spieler schließt ab oder gibt Gesuche.
 */
export async function kiAccess(db: DbOrTx, ki: { id: number; profile: string }, humanId: number, nowMs: number, all?: Map<number, KiStanding>): Promise<KiAccess> {
  const cfg = politikOf(balance)?.ansehen;
  const map = all ?? (await ansehenAll(db, humanId, nowMs));
  const st = map.get(ki.id);
  const value = st?.value ?? 0;
  const own = st?.level ?? "bekannt";
  const ruf = rufRules() ? await rufOf(db, humanId, nowMs) : null;
  const angesehen = ruf?.level === "angesehen";
  const level = angesehen && own === "bekannt" ? "vertraut" : own;
  const fx = cfg ? ansehenEffects(level, cfg) : { bonusDelta: 0, quotaShare: null, gesuche: true, pakt: false };
  const notorious = ruf ? ruf.level === "beruechtigt" : cfg ? isNotorious([...map.values()].map((x) => x.value), map.size, cfg) : false;
  const aechtungUntilMs = ruf ? await aechtungUntil(db, humanId, nowMs) : null;
  const blockHours = Math.max(cfg?.raidBlockHours ?? 0, balance.market.contracts?.ki.attackBlockHours ?? 0);
  const blocked = st?.lastRaidMs != null && nowMs - st.lastRaidMs < blockHours * HOUR_MS;
  const strict = ki.profile !== "freibeuter";
  const reason = aechtungUntilMs !== null ? "aechtung" : !strict ? null : blocked ? "ueberfall" : notorious ? "beruechtigt" : null;
  return {
    value, level, refuses: reason !== null, reason, bonusDelta: fx.bonusDelta, quotaShare: fx.quotaShare,
    gesuche: fx.gesuche && reason === null && !notorious, pakt: fx.pakt && reason === null, notorious,
    blockedUntilMs: strict && blocked ? st!.lastRaidMs! + blockHours * HOUR_MS : null,
    angesehen, aechtungUntilMs,
  };
}

/** Kopfgeld-Zuschlag für einen Angriff auf diesen Menschen: Ächtung + aechtungBounty, sonst Berüchtigt + notoriousBounty, sonst 0. */
export async function notoriousBounty(db: DbOrTx, defenderId: number, atMs: number): Promise<number> {
  const cfg = politikOf(balance)?.ansehen;
  const rc = rufRules();
  const base = rc?.notoriousBounty ?? cfg?.notoriousBounty ?? 0;
  if (!cfg || !(base > 0)) return 0;
  const [p] = await db.select({ bot: tables.player.botProfile }).from(tables.player).where(eq(tables.player.id, defenderId));
  if (!p || p.bot !== null) return 0;
  if (rc && (await aechtungUntil(db, defenderId, atMs)) !== null) return Math.max(base, rc.aechtungBounty);
  return (await notoriousOf(db, defenderId, atMs)) ? base : 0;
}

/** Merker: ein Mensch hat einen Pakt mit einem KI-Spieler gekündigt (Erlöschen endsAtMs) – für den Paktbruch. */
export async function notePactCancelled(db: DbOrTx, humanId: number, kiId: number, endsAtMs: number, diplomacyId: number): Promise<void> {
  const s = await politikSeason(db);
  if (!s) return;
  await db.insert(tables.ansehenMerker).values({ seasonId: s.id, playerId: humanId, kiId, kind: "pakt_ende", atMs: endsAtMs, ref: `pakt:${diplomacyId}` }).onConflictDoNothing();
}

/** Partei "p:<id>" eines KI-Spielers → KI-Spieler, sonst null (Allianzen und Menschen). */
export async function kiOfParty(db: DbOrTx, party: string): Promise<{ id: number; profile: string } | null> {
  const m = /^p:(\d+)$/.exec(party);
  if (!m) return null;
  const [p] = await db.select({ id: tables.player.id, profile: tables.player.botProfile }).from(tables.player).where(eq(tables.player.id, Number(m[1])));
  return p && p.profile !== null ? { id: p.id, profile: p.profile } : null;
}
