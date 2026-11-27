// Allianzen: gründen, einladen und beitreten auf Anfrage, Rollen, verlassen, ausschließen, auflösen; Allianz-Chat.
// Jede Änderung sperrt zuerst die Allianzzeile (FOR UPDATE), damit Größe und Rollen nicht gleichzeitig kippen.
import { and, desc, eq, sql } from "drizzle-orm";
import { tables, type Tx } from "@tidefront/db";
import type { Engine } from "./context.ts";
import { allianceOpsExit } from "./alliance-ops-raid.ts"; // Allianz-Ops
import {
  act,
  allianceMaxSize,
  CHAT_MAX,
  DESCRIPTION_MAX,
  fail,
  memberIds,
  membershipOf,
  officerIds,
  partyMembers,
  partyName,
  ROLES,
  systemMessage,
  type Membership,
  type Notes,
  type Role,
} from "./alliance-core.ts";

export const NAME_RE = /^[\p{L}\p{N} _.'-]{3,32}$/u;
export const TAG_RE = /^[\p{L}\p{N}]{2,4}$/u;

const RANK: Record<Role, number> = { fuehrung: 3, offizier: 2, mitglied: 1 };
export const ROLE_TEXT: Record<Role, string> = { fuehrung: "Führung", offizier: "Offizier", mitglied: "Mitglied" };

async function lockAlliance(tx: Tx, id: number) {
  const [a] = await tx.select().from(tables.alliance).where(eq(tables.alliance.id, id)).for("update");
  return a ?? null;
}

/** Eigene Mitgliedschaft mit gesperrter Allianz; mindestens die verlangte Rolle. */
async function ownLocked(tx: Tx, playerId: number, min: Role = "mitglied"): Promise<Membership> {
  const m = await membershipOf(tx, playerId);
  if (!m) fail("no_alliance");
  if (!(await lockAlliance(tx, m.allianceId))) fail("no_alliance");
  // Nach der Sperre neu lesen: Rolle oder Mitgliedschaft könnten sich gerade geändert haben.
  const fresh = await membershipOf(tx, playerId);
  if (!fresh || fresh.allianceId !== m.allianceId) fail("no_alliance");
  if (RANK[fresh.role] < RANK[min]) fail("no_rights");
  return fresh;
}

async function playerNameOf(tx: Tx, id: number): Promise<string> {
  const [p] = await tx.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, id));
  if (!p) fail("no_player");
  return p.name;
}

/**
 * Nimmt einen Spieler auf (Allianz bereits gesperrt). Größe prüfen, offene Anfragen des Spielers löschen; seine
 * eigenen Verträge als Einzelspieler erlöschen (die der Allianz gelten jetzt für ihn).
 */
/** Verträge des Spielers als Einzelpartei erlöschen (beim Gründen oder Beitreten); die Gegenseite erfährt es. */
async function dropOwnTreaties(tx: Tx, notes: Notes, playerId: number): Promise<void> {
  const own = `p:${playerId}`;
  const treaties = await tx.select().from(tables.diplomacy).where(sql`${tables.diplomacy.partyA} = ${own} or ${tables.diplomacy.partyB} = ${own}`);
  for (const d of treaties) {
    const other = d.partyA === own ? d.partyB : d.partyA;
    await tx.delete(tables.diplomacy).where(eq(tables.diplomacy.id, d.id));
    await systemMessage(tx, notes, await partyMembers(tx, other), "Diplomatie: Vertrag erloschen",
      `${await playerNameOf(tx, playerId)} gehört jetzt einer Allianz an. ${d.kind === "pakt" ? "Der Nichtangriffspakt" : "Der Kriegszustand"} mit ihm ist erloschen.`);
  }
}

async function join(tx: Tx, notes: Notes, allianceId: number, playerId: number): Promise<void> {
  const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(tables.allianceMember).where(eq(tables.allianceMember.allianceId, allianceId));
  if ((n?.n ?? 0) >= (await allianceMaxSize(tx))) fail("alliance_full");
  const ins = await tx.insert(tables.allianceMember).values({ playerId, allianceId, role: "mitglied" }).onConflictDoNothing().returning();
  if (ins.length === 0) fail("in_alliance");
  await tx.delete(tables.allianceRequest).where(eq(tables.allianceRequest.playerId, playerId));
  await dropOwnTreaties(tx, notes, playerId);
  const ids = await memberIds(tx, allianceId);
  await systemMessage(tx, notes, ids, "Allianz: neues Mitglied", `${await playerNameOf(tx, playerId)} ist ${await partyName(tx, `a:${allianceId}`)} beigetreten.`);
  notes.push([ids, "alliance"], [null, "alliance"]);
}

export function createAlliance(engine: Engine, playerId: number, input: { name: string; tag: string; description?: string }) {
  return act(engine, async (tx, notes) => {
    const name = input.name.trim().replace(/\s+/g, " ");
    const tag = input.tag.trim();
    if (!NAME_RE.test(name)) fail("bad_name");
    if (!TAG_RE.test(tag)) fail("bad_tag");
    if (await membershipOf(tx, playerId)) fail("in_alliance");
    const [taken] = await tx
      .select({ name: tables.alliance.name, tag: tables.alliance.tag })
      .from(tables.alliance)
      .where(sql`lower(${tables.alliance.name}) = lower(${name}) or lower(${tables.alliance.tag}) = lower(${tag})`);
    if (taken) fail(taken.name.toLowerCase() === name.toLowerCase() ? "name_taken" : "tag_taken");
    const [a] = await tx
      .insert(tables.alliance)
      .values({ name, tag, description: (input.description ?? "").trim().slice(0, DESCRIPTION_MAX) })
      .onConflictDoNothing()
      .returning({ id: tables.alliance.id });
    if (!a) fail("name_taken");
    const ins = await tx.insert(tables.allianceMember).values({ playerId, allianceId: a.id, role: "fuehrung" }).onConflictDoNothing().returning();
    if (ins.length === 0) fail("in_alliance");
    await tx.delete(tables.allianceRequest).where(eq(tables.allianceRequest.playerId, playerId));
    await dropOwnTreaties(tx, notes, playerId);
    notes.push([null, "alliance"]);
    return { ok: true as const, allianceId: a.id };
  });
}

export function updateAlliance(engine: Engine, playerId: number, input: { description: string }) {
  return act(engine, async (tx, notes) => {
    const m = await ownLocked(tx, playerId, "offizier");
    await tx.update(tables.alliance).set({ description: input.description.trim().slice(0, DESCRIPTION_MAX) }).where(eq(tables.alliance.id, m.allianceId));
    notes.push([await memberIds(tx, m.allianceId), "alliance"]);
    return { ok: true as const };
  });
}

/** Führung oder Offizier lädt einen Spieler ein. Hat er schon angefragt, tritt er sofort bei. */
export function invitePlayer(engine: Engine, playerId: number, targetId: number) {
  return act(engine, async (tx, notes) => {
    const m = await ownLocked(tx, playerId, "offizier");
    await playerNameOf(tx, targetId);
    if (await membershipOf(tx, targetId)) fail("target_in_alliance");
    const [prev] = await tx
      .select()
      .from(tables.allianceRequest)
      .where(and(eq(tables.allianceRequest.allianceId, m.allianceId), eq(tables.allianceRequest.playerId, targetId)));
    if (prev?.kind === "anfrage") {
      await join(tx, notes, m.allianceId, targetId);
      return { ok: true as const, joined: true };
    }
    if (prev) fail("already_invited");
    await tx.insert(tables.allianceRequest).values({ allianceId: m.allianceId, playerId: targetId, kind: "einladung", createdBy: playerId });
    await systemMessage(tx, notes, [targetId], "Allianz: Einladung",
      `${await playerNameOf(tx, playerId)} lädt dich in die Allianz [${m.tag}] ${m.name} ein. Annehmen unter Truppen → Allianz.`);
    notes.push([[targetId], "alliance"], [await officerIds(tx, m.allianceId), "alliance"]);
    return { ok: true as const, joined: false };
  });
}

/** Spieler ohne Allianz fragt an. Liegt schon eine Einladung vor, tritt er sofort bei. */
export function requestJoin(engine: Engine, playerId: number, allianceId: number) {
  return act(engine, async (tx, notes) => {
    const a = await lockAlliance(tx, allianceId);
    if (!a) fail("no_alliance");
    if (await membershipOf(tx, playerId)) fail("in_alliance");
    const [prev] = await tx
      .select()
      .from(tables.allianceRequest)
      .where(and(eq(tables.allianceRequest.allianceId, allianceId), eq(tables.allianceRequest.playerId, playerId)));
    if (prev?.kind === "einladung") {
      await join(tx, notes, allianceId, playerId);
      return { ok: true as const, joined: true };
    }
    if (prev) fail("already_requested");
    await tx.insert(tables.allianceRequest).values({ allianceId, playerId, kind: "anfrage", createdBy: playerId });
    const officers = await officerIds(tx, allianceId);
    await systemMessage(tx, notes, officers, "Allianz: Beitrittsanfrage",
      `${await playerNameOf(tx, playerId)} möchte [${a.tag}] ${a.name} beitreten. Entscheiden unter Truppen → Allianz.`);
    notes.push([officers, "alliance"], [[playerId], "alliance"]);
    return { ok: true as const, joined: false };
  });
}

/** Einladung annehmen (eingeladener Spieler) oder Anfrage annehmen (Führung oder Offizier). */
export function acceptRequest(engine: Engine, playerId: number, requestId: number) {
  return act(engine, async (tx, notes) => {
    const [r0] = await tx.select().from(tables.allianceRequest).where(eq(tables.allianceRequest.id, requestId));
    if (!r0) fail("no_request");
    if (!(await lockAlliance(tx, r0.allianceId))) fail("no_request");
    const [r] = await tx.select().from(tables.allianceRequest).where(eq(tables.allianceRequest.id, requestId));
    if (!r) fail("no_request");
    if (r.kind === "einladung") {
      if (r.playerId !== playerId) fail("no_rights");
    } else {
      const m = await membershipOf(tx, playerId);
      if (!m || m.allianceId !== r.allianceId || RANK[m.role] < RANK.offizier) fail("no_rights");
    }
    await join(tx, notes, r.allianceId, r.playerId);
    return { ok: true as const };
  });
}

/** Einladung oder Anfrage ablehnen bzw. zurückziehen (beide Seiten). */
export function declineRequest(engine: Engine, playerId: number, requestId: number) {
  return act(engine, async (tx, notes) => {
    const [r] = await tx.select().from(tables.allianceRequest).where(eq(tables.allianceRequest.id, requestId));
    if (!r) fail("no_request");
    const m = await membershipOf(tx, playerId);
    const officer = !!m && m.allianceId === r.allianceId && RANK[m.role] >= RANK.offizier;
    if (r.playerId !== playerId && !officer) fail("no_rights");
    await tx.delete(tables.allianceRequest).where(eq(tables.allianceRequest.id, r.id));
    notes.push([[r.playerId], "alliance"], [await officerIds(tx, r.allianceId), "alliance"]);
    return { ok: true as const };
  });
}

/** Austritt. Geht die Führung, übernimmt der dienstälteste Offizier, sonst das dienstälteste Mitglied. Der Letzte löst auf. */
export function leaveAlliance(engine: Engine, playerId: number) {
  return act(engine, async (tx, notes) => {
    const m = await ownLocked(tx, playerId);
    await tx.delete(tables.allianceMember).where(eq(tables.allianceMember.playerId, playerId));
    const rest = await tx
      .select()
      .from(tables.allianceMember)
      .where(eq(tables.allianceMember.allianceId, m.allianceId))
      .orderBy(tables.allianceMember.joinedAt);
    const name = await playerNameOf(tx, playerId);
    await allianceOpsExit(tx, notes, [playerId], m.allianceId); // Allianz-Ops: Stationierungen heim, Teilnahmen enden
    if (rest.length === 0) {
      await removeAlliance(tx, notes, m.allianceId, `[${m.tag}] ${m.name} hat sich aufgelöst: das letzte Mitglied ist ausgetreten.`);
    } else {
      let text = `${name} hat die Allianz verlassen.`;
      if (m.role === "fuehrung") {
        const next = rest.find((r) => r.role === "offizier") ?? rest[0];
        await tx.update(tables.allianceMember).set({ role: "fuehrung" }).where(eq(tables.allianceMember.playerId, next.playerId));
        text += ` Neue Führung: ${await playerNameOf(tx, next.playerId)}.`;
      }
      await systemMessage(tx, notes, rest.map((r) => r.playerId), "Allianz: Austritt", text);
      notes.push([rest.map((r) => r.playerId), "alliance"]);
    }
    notes.push([[playerId], "alliance"], [null, "alliance"]);
    return { ok: true as const };
  });
}

/** Ausschließen: Führung alle außer sich selbst, Offiziere nur Mitglieder. */
export function kickMember(engine: Engine, playerId: number, targetId: number) {
  return act(engine, async (tx, notes) => {
    const m = await ownLocked(tx, playerId, "offizier");
    if (targetId === playerId) fail("self");
    const t = await membershipOf(tx, targetId);
    if (!t || t.allianceId !== m.allianceId) fail("not_member");
    if (RANK[t.role] >= RANK[m.role]) fail("no_rights");
    await tx.delete(tables.allianceMember).where(eq(tables.allianceMember.playerId, targetId));
    await allianceOpsExit(tx, notes, [targetId], m.allianceId); // Allianz-Ops
    const name = await playerNameOf(tx, targetId);
    await systemMessage(tx, notes, [targetId], "Allianz: ausgeschlossen", `Du wurdest aus [${m.tag}] ${m.name} ausgeschlossen.`);
    const ids = await memberIds(tx, m.allianceId);
    await systemMessage(tx, notes, ids, "Allianz: Ausschluss", `${name} wurde aus der Allianz ausgeschlossen.`);
    notes.push([ids, "alliance"], [[targetId], "alliance"], [null, "alliance"]);
    return { ok: true as const };
  });
}

/** Rollen vergibt nur die Führung. Rolle fuehrung übergibt die Führung (man selbst wird Offizier). */
export function setMemberRole(engine: Engine, playerId: number, targetId: number, role: Role) {
  return act(engine, async (tx, notes) => {
    if (!ROLES.includes(role)) fail("bad_role");
    const m = await ownLocked(tx, playerId, "fuehrung");
    if (targetId === playerId) fail("self");
    const t = await membershipOf(tx, targetId);
    if (!t || t.allianceId !== m.allianceId) fail("not_member");
    await tx.update(tables.allianceMember).set({ role }).where(eq(tables.allianceMember.playerId, targetId));
    if (role === "fuehrung") await tx.update(tables.allianceMember).set({ role: "offizier" }).where(eq(tables.allianceMember.playerId, playerId));
    const ids = await memberIds(tx, m.allianceId);
    await systemMessage(tx, notes, ids, "Allianz: Rolle", `${await playerNameOf(tx, targetId)} ist jetzt ${ROLE_TEXT[role]}.`);
    notes.push([ids, "alliance"]);
    return { ok: true as const };
  });
}

/** Allianz und ihre Verträge löschen (Mitglieder, Anfragen, Chat per Kaskade). */
async function removeAlliance(tx: Tx, notes: Notes, allianceId: number, text: string): Promise<void> {
  const party = `a:${allianceId}`;
  const ids = await memberIds(tx, allianceId);
  const treaties = await tx.select().from(tables.diplomacy).where(sql`${tables.diplomacy.partyA} = ${party} or ${tables.diplomacy.partyB} = ${party}`);
  for (const d of treaties) {
    const other = d.partyA === party ? d.partyB : d.partyA;
    await systemMessage(tx, notes, await partyMembers(tx, other), "Diplomatie: Vertrag erloschen", `${text} Verträge mit ihr sind erloschen.`);
  }
  await tx.delete(tables.diplomacy).where(sql`${tables.diplomacy.partyA} = ${party} or ${tables.diplomacy.partyB} = ${party}`);
  await systemMessage(tx, notes, ids, "Allianz aufgelöst", text);
  await tx.delete(tables.alliance).where(eq(tables.alliance.id, allianceId));
  await allianceOpsExit(tx, notes, ids, allianceId); // Allianz-Ops
  notes.push([ids, "alliance"], [null, "alliance"]);
}

export function dissolveAlliance(engine: Engine, playerId: number) {
  return act(engine, async (tx, notes) => {
    const m = await ownLocked(tx, playerId, "fuehrung");
    await removeAlliance(tx, notes, m.allianceId, `Die Führung hat [${m.tag}] ${m.name} aufgelöst.`);
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- Chat

export async function sendAllianceChat(engine: Engine, playerId: number, text: string) {
  return act(engine, async (tx, notes) => {
    const body = text.trim().slice(0, CHAT_MAX);
    if (!body) fail("empty");
    const m = await membershipOf(tx, playerId);
    if (!m) fail("no_alliance");
    const [c] = await tx.insert(tables.allianceChat).values({ allianceId: m.allianceId, playerId, body }).returning({ id: tables.allianceChat.id });
    notes.push([await memberIds(tx, m.allianceId), "alliance"]);
    return { ok: true as const, id: c.id };
  });
}

/** Die letzten 100 Chatzeilen der eigenen Allianz, älteste zuerst. */
export async function allianceChatList(engine: Engine, playerId: number) {
  const m = await membershipOf(engine.db, playerId);
  if (!m) return [];
  const rows = await engine.db
    .select({ id: tables.allianceChat.id, body: tables.allianceChat.body, createdAt: tables.allianceChat.createdAt, playerId: tables.allianceChat.playerId, name: tables.player.name })
    .from(tables.allianceChat)
    .leftJoin(tables.player, eq(tables.player.id, tables.allianceChat.playerId))
    .where(eq(tables.allianceChat.allianceId, m.allianceId))
    .orderBy(desc(tables.allianceChat.createdAt), desc(tables.allianceChat.id))
    .limit(100);
  return rows.reverse().map((r) => ({ id: r.id, body: r.body, atMs: r.createdAt.getTime(), playerId: r.playerId, name: r.name ?? "?", own: r.playerId === playerId }));
}
