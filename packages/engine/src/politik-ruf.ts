// Weltpolitik Stufe 2: globaler Ruf je Mensch (docs/REGELN-WELTPOLITIK.md, Abschnitt 3a). Kein Zähler: gerechnet beim
// Lesen aus den Zeilen der Saison – KI-Lieferverträge (erfüllt +2), Gesuche (+5), gezahlte Gebühren (Börse und
// KI-Verträge, +1 je 1 000 Taler), Hilfe gegen das Kartell im fremden Hafen (+2, Paarbremse), Konvoi/Feld gegen eine
// Kartellgruppe ≥ 6 Boote gehalten (+1), Überfall auf ein Schwachziel ohne Krieg (−8), Vertragsstrafe (−10),
// Blockade eines Spielerhafens ohne Krieg (−3 je Tag), Paktbruch (−15) – und den Merkern in ruf_merker.
// Der Ruf zählt nicht im Rang und ändert keine Börsenpreise.
import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { blockadeDays, politikOf, rufAt, type RufBalance, type RufEntry, type RufResult } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { atWar, partyOf } from "./alliance-core.ts";
import { politikSeason } from "./politik-core.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Merker des Rufs liegen in ansehen_merker mit ki_id 0 (kein KI-Spieler). */
const RUF_KI = 0;

export function rufRules(): RufBalance | null {
  return politikOf(balance)?.ruf ?? null;
}

export interface RufStanding extends RufResult {
  playerId: number;
}

/** Menschen (ohne KI-Spieler), optional nur die genannten; mit Beginn des Anfängerschutzes (Anmeldung). */
async function humans(db: DbOrTx, ids?: number[]): Promise<Map<number, number>> {
  const p = tables.player;
  const rows = await db.select({ id: p.id, createdAt: p.createdAt }).from(p)
    .where(ids ? and(isNull(p.botProfile), inArray(p.id, ids.length > 0 ? ids : [-1])) : isNull(p.botProfile));
  return new Map(rows.map((r) => [r.id, r.createdAt.getTime()]));
}

/** Belege aller (bzw. der genannten) Menschen seit Saisonbeginn. */
async function rufEntries(db: DbOrTx, sinceMs: number, seasonId: number, people: Map<number, number>, cfg: RufBalance, only: boolean): Promise<Map<number, RufEntry[]>> {
  const out = new Map<number, RufEntry[]>([...people.keys()].map((id) => [id, []]));
  const add = (id: number | null, e: RufEntry) => { if (id !== null) out.get(id)?.push(e); };
  const ids = [...people.keys()];
  if (ids.length === 0) return out;
  const since = new Date(sinceMs);

  // Verträge: KI-Vertrag erfüllt (+), Vertragsstrafe jeder Art (−).
  const c = tables.marketContract;
  const contracts = await db.select({ id: c.id, kind: c.kind, status: c.status, sellerId: c.sellerId, buyerId: c.buyerId, closedAt: c.closedAt, dueAt: c.dueAt,
    sp: c.sellerPenaltyCents, bp: c.buyerPenaltyCents }).from(c).where(and(gte(c.createdAt, since), or(inArray(c.sellerId, ids), inArray(c.buyerId, ids))));
  for (const r of contracts) {
    const at = (r.closedAt ?? r.dueAt).getTime();
    for (const [side, pen] of [[r.sellerId, r.sp], [r.buyerId, r.bp]] as const) {
      if (side === null || !people.has(side)) continue;
      if (r.kind === "ki" && r.status === "erfuellt") add(side, { atMs: at, kind: "vertrag", ref: `vertrag:${r.id}` });
      if (pen > 0) add(side, { atMs: at, kind: "strafe", ref: `vertrag:${r.id}` });
    }
  }
  // Gesuche erfüllt.
  const g = tables.kiGesuch;
  for (const r of await db.select({ id: g.id, playerId: g.playerId, closedAt: g.closedAt }).from(g).where(and(eq(g.seasonId, seasonId), eq(g.status, "erfuellt"), inArray(g.playerId, ids)))) {
    if (r.closedAt) add(r.playerId, { atMs: r.closedAt.getTime(), kind: "gesuch", ref: `gesuch:${r.id}` });
  }
  // Handel: gezahlte Gebühr in Taler je Geschäft mit genau einem Menschen (Börse, KI-Verträge). Geschäfte zwischen
  // zwei Menschen zählen nicht (Freunde schieben sich sonst Ruf zu).
  // Einzelne Spieler: nur ihre Geschäfte (Index auf account), sonst alle seit Saisonbeginn (Index auf t_ms).
  const scope = only
    ? sql`trade_id in (select trade_id from trade_ledger where account in (${sql.join(ids.map((id) => sql`${`player:${id}`}`), sql`, `)}) and asset = 'credits' and t_ms >= ${sinceMs})`
    : sql`t_ms >= ${sinceMs}`;
  const fees = await db.execute<{ pid: number; t: string; fee: number }>(sql`
    with f as (select trade_id, min(t_ms) t, sum(amount)::float8 fee from trade_ledger
               where account = 'fees' and asset = 'credits' and ${scope} group by trade_id),
         p as (select l.trade_id, min(pl.id) pid, count(distinct pl.id) n from trade_ledger l
               join player pl on l.account = 'player:' || pl.id
               where pl.bot_profile is null and l.account like 'player:%' and l.trade_id in (select trade_id from f) group by l.trade_id)
    select p.pid, f.t, f.fee from f join p using (trade_id) where p.n = 1 and f.fee > 0`);
  for (const r of fees) add(Number(r.pid), { atMs: Number(r.t), kind: "handel", amount: Number(r.fee) });

  // Berichte: Schwachziel-Überfälle, Hilfe im fremden Hafen, Kartell-Abwehr an Konvoi und Feld.
  const br = tables.battleReport;
  const reports = await db.select({
    id: br.id, kind: br.kind, attacker: br.attackerPlayerId, defender: br.defenderPlayerId, winner: br.winner, createdAt: br.createdAt,
    weak: sql<boolean>`coalesce((${br.report}->'attacker'->>'weakTarget')::boolean, false)`,
    guests: sql<number[] | null>`(select jsonb_agg((x->>'playerId')::int) from jsonb_array_elements(case when jsonb_typeof(${br.report}->'guests') = 'array' then ${br.report}->'guests' else '[]'::jsonb end) x)`,
    boats: sql<number>`coalesce((select sum(v::numeric) from jsonb_each_text(case when jsonb_typeof(coalesce(${br.report}->'convoy'->'force', ${br.report}->'attacker'->'units')) = 'object' then coalesce(${br.report}->'convoy'->'force', ${br.report}->'attacker'->'units') else '{}'::jsonb end) as e(k, v)), 0)::float8`,
  }).from(br).where(and(gte(br.createdAt, since), only
    // Einzelne Spieler: eigene Überfälle, Kartell-Abwehr als Verteidiger, Hilfe (Gäste stehen nur im Bericht).
    ? or(and(eq(br.kind, "ueberfall"), inArray(br.attackerPlayerId, ids)), eq(br.kind, "kartell"), and(inArray(br.kind, ["konvoi", "feld"]), inArray(br.defenderPlayerId, ids)))
    : inArray(br.kind, ["ueberfall", "kartell", "konvoi", "feld"])));
  const raids: { attacker: number; defender: number; atMs: number; id: number }[] = [];
  for (const r of reports) {
    const at = r.createdAt.getTime();
    if (r.kind === "ueberfall" && r.attacker !== null && r.defender !== null) {
      raids.push({ attacker: r.attacker, defender: r.defender, atMs: at, id: r.id });
      // Nur Schwachziele unter Menschen (ein Überfall auf einen KI-Spieler wirkt nur auf das Ansehen bei ihm).
      if (r.weak && people.has(r.attacker) && (await isHuman(db, r.defender))) add(r.attacker, { atMs: at, kind: "schwachziel", ref: `bericht:${r.id}` });
    } else if (r.kind === "kartell" && r.winner === "defender" && r.defender !== null) {
      for (const gid of r.guests ?? []) if (gid !== r.defender) add(gid, { atMs: at, kind: "hilfe", ref: `bericht:${r.id}`, partner: r.defender });
    } else if ((r.kind === "konvoi" || r.kind === "feld") && r.attacker === null && r.winner === "defender" && Number(r.boats) >= cfg.cartelHoldMinBoats) {
      add(r.defender, { atMs: at, kind: "kartell", ref: `bericht:${r.id}` });
    }
  }
  // Blockaden vor Spielerhäfen ohne Krieg: je angefangenem Tag.
  const bl = tables.blockade;
  const blocks = await db.select().from(bl).where(and(gte(bl.endsAt, since), inArray(bl.attackerId, ids)));
  for (const b of blocks) {
    if (!(await isHuman(db, b.targetPlayerId)) || (await atWar(db, b.attackerId, b.targetPlayerId, b.startsAt.getTime()))) continue;
    const end = b.endedAt?.getTime() ?? b.endsAt.getTime();
    blockadeDays(b.startsAt.getTime(), end, Number.POSITIVE_INFINITY).forEach((t, i) => add(b.attackerId, { atMs: t, kind: "blockade", ref: `blockade:${b.id}:${i}` }));
  }
  // Paktbruch: Überfall auf den Ex-Partner oder Kriegserklärung an ihn ≤ pactBreakHours nach Erlöschen (einmal je Pakt).
  const m = tables.ansehenMerker;
  const marks = await db.select().from(m).where(and(eq(m.seasonId, seasonId), eq(m.kiId, RUF_KI), eq(m.kind, "ruf_pakt_ende"), inArray(m.playerId, ids)));
  for (const k of marks) {
    const partner = k.ref.split(":")[3] + ":" + k.ref.split(":")[4];
    const until = k.atMs + cfg.pactBreakHours * HOUR_MS;
    const members = await partyMembers(db, partner);
    const raid = raids.find((r) => r.attacker === k.playerId && members.has(r.defender) && r.atMs >= k.atMs && r.atMs <= until);
    let at = raid?.atMs ?? null;
    if (at === null) {
      const own = await partyOf(db, k.playerId);
      const d = tables.diplomacy;
      const wars = await db.select({ createdAt: d.createdAt, a: d.partyA, b: d.partyB, by: d.proposedBy }).from(d)
        .where(and(eq(d.kind, "krieg"), eq(d.proposedBy, own), or(eq(d.partyA, partner), eq(d.partyB, partner))));
      const w = wars.find((x) => x.createdAt.getTime() >= k.atMs && x.createdAt.getTime() <= until);
      at = w?.createdAt.getTime() ?? null;
    }
    if (at !== null) add(k.playerId, { atMs: at, kind: "paktbruch", ref: k.ref });
  }
  return out;
}

const humanCache = new Map<number, boolean>();
async function isHuman(db: DbOrTx, id: number): Promise<boolean> {
  const hit = humanCache.get(id);
  if (hit !== undefined) return hit;
  const [p] = await db.select({ bot: tables.player.botProfile }).from(tables.player).where(eq(tables.player.id, id));
  const v = !!p && p.bot === null;
  if (humanCache.size > 5000) humanCache.clear();
  humanCache.set(id, v);
  return v;
}

async function partyMembers(db: DbOrTx, party: string): Promise<Set<number>> {
  const m = /^(p|a):(\d+)$/.exec(party);
  if (!m) return new Set();
  if (m[1] === "p") return new Set([Number(m[2])]);
  const rows = await db.select({ id: tables.allianceMember.playerId }).from(tables.allianceMember).where(eq(tables.allianceMember.allianceId, Number(m[2])));
  return new Set(rows.map((r) => r.id));
}

/** Ruf der genannten (bzw. aller) Menschen zum Zeitpunkt nowMs; leer ohne Saison oder ohne Balance-Block. */
export async function rufMap(db: DbOrTx, nowMs: number, ids?: number[]): Promise<Map<number, RufStanding>> {
  const cfg = rufRules();
  const out = new Map<number, RufStanding>();
  const s = await politikSeason(db);
  if (!cfg || !s) return out;
  const people = await humans(db, ids);
  const entries = await rufEntries(db, s.startMs, s.id, people, cfg, ids !== undefined);
  for (const [id, list] of entries) {
    const protectedUntil = (people.get(id) ?? 0) + cfg.protectionDays * DAY_MS;
    out.set(id, { playerId: id, ...rufAt(list, s.startMs, nowMs, cfg, protectedUntil) });
  }
  return out;
}

/** Ruf eines Menschen (KI-Spieler: null). */
export async function rufOf(db: DbOrTx, playerId: number, nowMs: number): Promise<RufStanding | null> {
  return (await rufMap(db, nowMs, [playerId])).get(playerId) ?? null;
}

let allCache: { atMs: number; map: Map<number, RufStanding> } | null = null;

/** Ruf aller Menschen für die Rangliste (60 s zwischengespeichert; neu gerechnet, wenn der Betrachter fehlt). */
export async function rufAllCached(db: DbOrTx, nowMs: number, viewer?: number): Promise<Map<number, RufStanding>> {
  const fresh = allCache && nowMs >= allCache.atMs && nowMs - allCache.atMs < 60_000;
  if (fresh && (viewer === undefined || allCache!.map.has(viewer) || !(await isHuman(db, viewer)))) return allCache!.map;
  const map = await rufMap(db, nowMs);
  allCache = { atMs: nowMs, map };
  return map;
}

export function clearRufCache(): void {
  allCache = null;
  humanCache.clear();
}

// ---------------------------------------------------------------- Ächtung

/** Laufende Ächtung eines Spielers (Ende), sonst null. */
export async function aechtungUntil(db: DbOrTx, playerId: number, nowMs: number): Promise<number | null> {
  const m = tables.ansehenMerker;
  const rows = await db.select({ at: m.atMs, ref: m.ref }).from(m).where(and(eq(m.playerId, playerId), eq(m.kiId, RUF_KI), eq(m.kind, "aechtung")));
  let end: number | null = null;
  for (const r of rows) {
    const until = Number(r.ref.split(":")[2]);
    if (r.at <= nowMs && nowMs < until && (end === null || until > end)) end = until;
  }
  return end;
}

/** Ächtung eintragen (Merker je Spieler; ref nennt Sitzung und Ende). */
export async function noteAechtung(db: DbOrTx, seasonId: number, playerIds: number[], sitzungId: number, atMs: number, untilMs: number): Promise<void> {
  if (playerIds.length === 0) return;
  await db.insert(tables.ansehenMerker).values(playerIds.map((playerId) => ({
    seasonId, playerId, kiId: RUF_KI, kind: "aechtung", atMs, ref: `sitzung:${sitzungId}:${untilMs}`,
  }))).onConflictDoNothing();
}

/** Merker: ein Mensch (bzw. alle Menschen seiner Allianz) hat einen Pakt mit einem Menschen gekündigt. */
export async function noteHumanPactCancelled(db: DbOrTx, own: string, partner: string, endsAtMs: number, diplomacyId: number): Promise<void> {
  const s = await politikSeason(db);
  if (!s || !rufRules()) return;
  const members = [...(await partyMembers(db, own))];
  const people = await humans(db, members);
  if (people.size === 0) return;
  await db.insert(tables.ansehenMerker).values([...people.keys()].map((playerId) => ({
    seasonId: s.id, playerId, kiId: RUF_KI, kind: "ruf_pakt_ende", atMs: endsAtMs, ref: `pakt:${diplomacyId}:${endsAtMs}:${partner}`,
  }))).onConflictDoNothing();
}

/** Saison → Welt: eigener Ruf (Wert, Stufe, letzte 10 Buchungen, Ächtung) und Regeln für die Anzeige; null ohne Ruf. */
export async function rufView(db: DbOrTx, playerId: number, nowMs: number) {
  const cfg = rufRules();
  if (!cfg) return null;
  const r = await rufOf(db, playerId, nowMs);
  if (!r) return null;
  return {
    value: r.value, level: r.level, history: r.history.slice(-10).reverse(),
    aechtungUntilMs: await aechtungUntil(db, playerId, nowMs),
    rules: { angesehenFrom: cfg.angesehenFrom, beruechtigtTo: cfg.beruechtigtTo, decayPerDay: cfg.decayPerDay, notoriousBounty: cfg.notoriousBounty, aechtungBounty: cfg.aechtungBounty, aechtungHours: cfg.aechtungHours },
  };
}
