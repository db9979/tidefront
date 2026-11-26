// Allianzwertung zum Saisonende: Summe der Mitgliederpunkte (Endstand) je Allianz, Rangliste mit gleichen Plätzen
// bei Punktgleichheit. Gespeichert in season_alliance_result; gelesen von der Ruhmeshalle (hallOfFame).
import { eq, inArray } from "drizzle-orm";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";

export interface AllianceStanding {
  allianceId: number;
  name: string;
  tag: string;
  rank: number;
  members: number;
  total: number;
  playerIds: number[];
}

/** Rangliste der Allianzen aus den Gesamtpunkten der Spieler (`totals`: playerId → Punkte zum Saisonende). */
export async function allianceStandings(db: DbOrTx, totals: Map<number, number>): Promise<AllianceStanding[]> {
  const rows = await db
    .select({ allianceId: tables.allianceMember.allianceId, playerId: tables.allianceMember.playerId, name: tables.alliance.name, tag: tables.alliance.tag })
    .from(tables.allianceMember)
    .innerJoin(tables.alliance, eq(tables.alliance.id, tables.allianceMember.allianceId));
  const by = new Map<number, AllianceStanding>();
  for (const r of rows) {
    const a = by.get(r.allianceId) ?? { allianceId: r.allianceId, name: r.name, tag: r.tag, rank: 0, members: 0, total: 0, playerIds: [] };
    a.members++;
    a.total += totals.get(r.playerId) ?? 0;
    a.playerIds.push(r.playerId);
    by.set(r.allianceId, a);
  }
  const fp = await (await import("./fields-run.ts")).fieldPoints(db); // Felder: Feldpunkte der Allianzen
  for (const a of by.values()) a.total += fp.get(a.allianceId) ?? 0;
  const list = [...by.values()].sort((x, y) => y.total - x.total || x.name.localeCompare(y.name, "de"));
  list.forEach((a, i) => { a.rank = i > 0 && a.total === list[i - 1].total ? list[i - 1].rank : i + 1; });
  return list;
}

/** Saisonende: Allianzwertung speichern (idempotent je Saison und Allianz). */
export async function saveAllianceStandings(tx: Tx, seasonId: number, list: AllianceStanding[]): Promise<void> {
  if (list.length === 0) return;
  await tx
    .insert(tables.seasonAllianceResult)
    .values(list.map((a) => ({ seasonId, allianceId: a.allianceId, name: a.name, tag: a.tag, rank: a.rank, members: a.members, total: a.total, playerIds: a.playerIds })))
    .onConflictDoNothing();
}

/** Allianzwertungen beendeter Saisons, je Saison nach Rang; `own` markiert die Allianz der Spielerin damals. */
export async function allianceResultsFor(db: DbOrTx, seasonIds: number[], playerId: number) {
  if (seasonIds.length === 0) return new Map<number, { rank: number; name: string; tag: string; members: number; total: number; own: boolean }[]>();
  const rows = await db
    .select()
    .from(tables.seasonAllianceResult)
    .where(inArray(tables.seasonAllianceResult.seasonId, seasonIds))
    .orderBy(tables.seasonAllianceResult.rank, tables.seasonAllianceResult.name);
  const out = new Map<number, { rank: number; name: string; tag: string; members: number; total: number; own: boolean }[]>();
  for (const r of rows) {
    const list = out.get(r.seasonId) ?? [];
    list.push({ rank: r.rank, name: r.name, tag: r.tag, members: r.members, total: r.total, own: (r.playerIds as number[]).includes(playerId) });
    out.set(r.seasonId, list);
  }
  return out;
}
