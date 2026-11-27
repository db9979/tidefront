// Weltpolitik: der KI-Spieler bietet den Nichtangriffspakt von sich aus an (Nutzerentscheid nach 0.38), sobald ein
// Mensch bei ihm „Vertraut“ ist (docs/REGELN-WELTPOLITIK.md, Abschnitt 3). Angebot = vorhandene Diplomatie-Zeile
// (status angeboten, proposed_by = KI), dazu Systemnachricht und Lage-Eintrag; Annehmen/Ablehnen über acceptPact /
// cancelPact. Nicht erneut innerhalb von offerEveryDays (Merker ansehen_merker, Art pakt_angebot). Nur für Menschen
// ohne Allianz: deren Partei ist der Spieler selbst (in einer Allianz verhandelt die Führung für alle).
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { politikOf } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance } from "./context.ts";
import { pair, systemMessage, type Notes } from "./alliance-core.ts";
import { activeHumans, politikKis, politikSeason, PROFILE_TEXT } from "./politik-core.ts";
import { ansehenAll, kiAccess } from "./politik-ansehen.ts";

const DAY_MS = 86_400_000;

export interface KiPaktOffer {
  id: number;
  kiId: number;
  kiName: string;
  profileText: string;
  offeredMs: number;
}

/** Offene Paktangebote von KI-Spielern an diesen Menschen. */
export async function kiPaktOffers(db: DbOrTx, playerId: number): Promise<KiPaktOffer[]> {
  const own = `p:${playerId}`;
  const d = tables.diplomacy;
  const rows = await db.select().from(d).where(and(eq(d.kind, "pakt"), eq(d.status, "angeboten"), or(eq(d.partyA, own), eq(d.partyB, own))));
  const out: KiPaktOffer[] = [];
  if (rows.length === 0) return out;
  const kis = new Map((await politikKis(db)).map((k) => [k.id, k]));
  for (const r of rows) {
    const m = /^p:(\d+)$/.exec(r.proposedBy);
    const ki = m ? kis.get(Number(m[1])) : undefined;
    if (!ki || r.proposedBy === own) continue;
    out.push({ id: r.id, kiId: ki.id, kiName: ki.name, profileText: PROFILE_TEXT[ki.profile] ?? ki.profile, offeredMs: r.createdAt.getTime() });
  }
  return out;
}

/**
 * Wartungslauf: jeder KI-Spieler bietet jedem aktiven Menschen ohne Allianz, der bei ihm „Vertraut“ ist und mit dem es
 * weder Pakt, Angebot noch Krieg gibt, den Pakt an – höchstens einmal je offerEveryDays. Rückgabe: Notizen (Nachrichten).
 */
export async function offerKiPacts(tx: Tx, nowMs: number): Promise<Notes> {
  const notes: Notes = [];
  const cfg = politikOf(balance)?.ansehen;
  const s = await politikSeason(tx);
  if (!cfg || !s) return notes;
  const kis = await politikKis(tx);
  if (kis.length === 0) return notes;
  const humans = await activeHumans(tx, nowMs);
  if (humans.length === 0) return notes;
  const inAlliance = new Set((await tx.select({ id: tables.allianceMember.playerId }).from(tables.allianceMember)
    .where(inArray(tables.allianceMember.playerId, humans.map((h) => h.id)))).map((r) => r.id));
  const m = tables.ansehenMerker;
  const every = (cfg.pactOfferEveryDays ?? 7) * DAY_MS;
  for (const h of humans) {
    if (inAlliance.has(h.id)) continue;
    const all = await ansehenAll(tx, h.id, nowMs, kis.map((k) => k.id));
    for (const ki of kis) {
      if (all.get(ki.id)?.level !== "vertraut") continue;
      if (!(await kiAccess(tx, ki, h.id, nowMs, all)).pakt) continue;
      const [a, b] = pair(`p:${h.id}`, `p:${ki.id}`);
      const [existing] = await tx.select({ id: tables.diplomacy.id }).from(tables.diplomacy)
        .where(and(eq(tables.diplomacy.partyA, a), eq(tables.diplomacy.partyB, b))).limit(1);
      if (existing) continue;
      const [recent] = await tx.select({ id: m.id }).from(m).where(and(eq(m.playerId, h.id), eq(m.kiId, ki.id), eq(m.kind, "pakt_angebot"), gt(m.atMs, nowMs - every))).limit(1);
      if (recent) continue;
      await tx.execute(sql`select pg_advisory_xact_lock(7340100, hashtext(${`${a}|${b}`}))`);
      const [row] = await tx.insert(tables.diplomacy).values({ partyA: a, partyB: b, kind: "pakt", status: "angeboten", proposedBy: `p:${ki.id}`, createdAt: new Date(nowMs) })
        .onConflictDoNothing().returning({ id: tables.diplomacy.id });
      if (!row) continue;
      await tx.insert(m).values({ seasonId: s.id, playerId: h.id, kiId: ki.id, kind: "pakt_angebot", atMs: nowMs, ref: `pakt-angebot:${row.id}` }).onConflictDoNothing();
      const who = `${ki.name} (${PROFILE_TEXT[ki.profile] ?? ki.profile})`;
      await systemMessage(tx, notes, [h.id], `Diplomatie: Paktangebot von ${ki.name}`,
        `${who} schätzt eure Zusammenarbeit und bietet dir einen Nichtangriffspakt an. Annehmen oder ablehnen unter Basis → Lage (Weltpolitik) oder Meldungen → Allianz → Diplomatie.`);
      notes.push([[h.id], "alliance"]);
    }
  }
  return notes;
}

/** Ist diese Diplomatie-Zeile ein offenes Paktangebot eines KI-Spielers an diesen Menschen? */
export async function isKiOffer(db: DbOrTx, playerId: number, id: number): Promise<boolean> {
  return (await kiPaktOffers(db, playerId)).some((o) => o.id === id);
}
