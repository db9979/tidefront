// Allianzen und Diplomatie: gemeinsame Bausteine (Parteien, Mitgliedschaft, Systemnachrichten) und die Abfragen,
// die Befehle und Kampf-Handler brauchen (ally, pact, Krieg).
import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { GameError, type ChangeKind, type Engine } from "./context.ts";
import { getSetting } from "./settings.ts";

export const ROLES = ["fuehrung", "offizier", "mitglied"] as const;
export type Role = (typeof ROLES)[number];

/** Höchstgröße einer Allianz ohne Einstellung (server_setting alliance_max_size). */
export const ALLIANCE_MAX_DEFAULT = 8;
export const ALLIANCE_MAX_SETTING = "alliance_max_size";
/** Kündigungsfrist eines Nichtangriffspakts. */
export const PACT_NOTICE_MS = 24 * 3600000;
/** Vorlaufzeit einer Kriegserklärung. */
export const WAR_LEAD_MS = 12 * 3600000;
export const CHAT_MAX = 500;
export const DESCRIPTION_MAX = 500;

export type Notes = [number[] | null, ChangeKind][];

/** Eine Transaktion; Meldungen gehen erst nach dem Commit raus. */
export async function act<T>(engine: Engine, fn: (tx: Tx, notes: Notes) => Promise<T>): Promise<T> {
  const notes: Notes = [];
  const r = await engine.db.transaction((tx) => fn(tx, notes));
  for (const [ids, kind] of notes) engine.notify(ids, kind);
  return r;
}

export function fail(code: string): never {
  throw new GameError(code);
}

export async function allianceMaxSize(db: DbOrTx): Promise<number> {
  const n = Number(await getSetting(db, ALLIANCE_MAX_SETTING));
  return Number.isInteger(n) && n >= 2 && n <= 50 ? n : ALLIANCE_MAX_DEFAULT;
}

export interface Membership {
  allianceId: number;
  role: Role;
  name: string;
  tag: string;
}

export async function membershipOf(db: DbOrTx, playerId: number): Promise<Membership | null> {
  const [m] = await db
    .select({ allianceId: tables.allianceMember.allianceId, role: tables.allianceMember.role, name: tables.alliance.name, tag: tables.alliance.tag })
    .from(tables.allianceMember)
    .innerJoin(tables.alliance, eq(tables.alliance.id, tables.allianceMember.allianceId))
    .where(eq(tables.allianceMember.playerId, playerId));
  return m ? { ...m, role: m.role as Role } : null;
}

export async function memberIds(db: DbOrTx, allianceId: number): Promise<number[]> {
  const rows = await db.select({ id: tables.allianceMember.playerId }).from(tables.allianceMember).where(eq(tables.allianceMember.allianceId, allianceId));
  return rows.map((r) => r.id);
}

/** Führung und Offiziere einer Allianz. */
export async function officerIds(db: DbOrTx, allianceId: number): Promise<number[]> {
  const rows = await db
    .select({ id: tables.allianceMember.playerId })
    .from(tables.allianceMember)
    .where(and(eq(tables.allianceMember.allianceId, allianceId), inArray(tables.allianceMember.role, ["fuehrung", "offizier"])));
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------- Parteien

/** Partei eines Spielers: seine Allianz ("a:<id>") oder er selbst ("p:<id>"). */
export async function partyOf(db: DbOrTx, playerId: number): Promise<string> {
  const m = await membershipOf(db, playerId);
  return m ? `a:${m.allianceId}` : `p:${playerId}`;
}

export function parseParty(party: string): { kind: "a" | "p"; id: number } {
  const [k, id] = party.split(":");
  return { kind: k === "a" ? "a" : "p", id: Number(id) };
}

export async function partyMembers(db: DbOrTx, party: string): Promise<number[]> {
  const p = parseParty(party);
  return p.kind === "a" ? memberIds(db, p.id) : [p.id];
}

export async function partyName(db: DbOrTx, party: string): Promise<string> {
  const p = parseParty(party);
  if (p.kind === "a") {
    const [a] = await db.select({ name: tables.alliance.name, tag: tables.alliance.tag }).from(tables.alliance).where(eq(tables.alliance.id, p.id));
    return a ? `[${a.tag}] ${a.name}` : "?";
  }
  const [pl] = await db.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, p.id));
  return pl?.name ?? "?";
}

/** Paar in fester Reihenfolge (partyA < partyB). */
export function pair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/**
 * Abgelaufene Pakte (Kündigungsfrist vorbei) entfernen und beiden Seiten das Erlöschen melden. Idempotent:
 * Nachricht nur für die Zeilen, die dieser Aufruf tatsächlich löscht (geplantes Ereignis pact_expire oder
 * nächster Zugriff, je nachdem, was zuerst kommt).
 */
export async function purgeExpired(db: DbOrTx, nowMs: number, notes: Notes = []): Promise<void> {
  await db.transaction(async (tx) => {
    const gone = await tx
      .delete(tables.diplomacy)
      .where(and(eq(tables.diplomacy.kind, "pakt"), lte(tables.diplomacy.endsAt, new Date(nowMs))))
      .returning({ partyA: tables.diplomacy.partyA, partyB: tables.diplomacy.partyB, status: tables.diplomacy.status });
    for (const d of gone) {
      if (d.status !== "aktiv") continue;
      const ids = [...(await partyMembers(tx, d.partyA)), ...(await partyMembers(tx, d.partyB))];
      await systemMessage(tx, notes, ids, "Diplomatie: Pakt erloschen",
        `Der Nichtangriffspakt zwischen ${await partyName(tx, d.partyA)} und ${await partyName(tx, d.partyB)} ist erloschen. Überfälle sind wieder möglich.`);
      notes.push([[...new Set(ids)], "alliance"]);
    }
  });
}

/** Systemnachricht (Absender null) an mehrere Spieler, in der laufenden Transaktion. */
export async function systemMessage(tx: Tx, notes: Notes, ids: number[], subject: string, body: string): Promise<void> {
  const to = [...new Set(ids)];
  if (to.length === 0) return;
  await tx.insert(tables.message).values(to.map((id) => ({ fromPlayerId: null, toPlayerId: id, subject, body })));
  notes.push([to, "messages"]);
}

// ---------------------------------------------------------------- Abfragen für Befehle und Kampf

/** Gilt ein Nichtangriffspakt (auch während der Kündigungsfrist) zwischen den Parteien? */
async function pactActive(db: DbOrTx, x: string, y: string, atMs: number): Promise<boolean> {
  const [a, b] = pair(x, y);
  const [r] = await db
    .select({ id: tables.diplomacy.id })
    .from(tables.diplomacy)
    .where(and(
      eq(tables.diplomacy.partyA, a), eq(tables.diplomacy.partyB, b), eq(tables.diplomacy.kind, "pakt"),
      eq(tables.diplomacy.status, "aktiv"),
      or(isNull(tables.diplomacy.endsAt), gt(tables.diplomacy.endsAt, new Date(atMs))),
    ));
  return !!r;
}

/**
 * Darf attacker den Hafen von defender überfallen? Liefert den Ablehnungscode:
 * ally (dieselbe Allianz), pact (Nichtangriffspakt einschließlich Kündigungsfrist) oder null.
 */
export async function diplomacyBlock(db: DbOrTx, attackerId: number, defenderId: number, atMs: number): Promise<"ally" | "pact" | null> {
  const x = await partyOf(db, attackerId);
  const y = await partyOf(db, defenderId);
  if (x === y) return "ally";
  return (await pactActive(db, x, y, atMs)) ? "pact" : null;
}

/** Herrscht zum Zeitpunkt atMs Krieg (nach der Vorlaufzeit) zwischen den Parteien der beiden Spieler? */
export async function atWar(db: DbOrTx, attackerId: number, defenderId: number, atMs: number): Promise<boolean> {
  const [a, b] = pair(await partyOf(db, attackerId), await partyOf(db, defenderId));
  if (a === b) return false;
  const [r] = await db
    .select({ id: tables.diplomacy.id })
    .from(tables.diplomacy)
    .where(and(
      eq(tables.diplomacy.partyA, a), eq(tables.diplomacy.partyB, b), eq(tables.diplomacy.kind, "krieg"),
      lte(tables.diplomacy.activeFrom, new Date(atMs)),
    ));
  return !!r;
}
