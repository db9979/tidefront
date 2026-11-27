// Diplomatie zwischen Parteien (Allianz oder Spieler ohne Allianz): Nichtangriffspakt mit Bestätigung beider Seiten
// und 24 h Kündigungsfrist, Kriegserklärung mit 12 h Vorlauf, Frieden auf Gegenseitigkeit. Für eine Allianz handeln
// Führung und Offiziere. Jede Änderung eines Paars läuft unter einer Advisory-Sperre auf dieses Paar.
import { and, eq, sql } from "drizzle-orm";
import { gameTimeZone } from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import type { Engine } from "./context.ts";
import { scheduleEvent } from "./store.ts";
import {
  act,
  fail,
  membershipOf,
  pair,
  parseParty,
  PACT_NOTICE_MS,
  partyMembers,
  partyName,
  purgeExpired,
  systemMessage,
  WAR_LEAD_MS,
  type Notes,
} from "./alliance-core.ts";

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: gameTimeZone() });

/** Partei, für die der Spieler handeln darf. */
async function actorParty(tx: Tx, playerId: number): Promise<string> {
  const m = await membershipOf(tx, playerId);
  if (!m) return `p:${playerId}`;
  if (m.role === "mitglied") fail("no_rights");
  return `a:${m.allianceId}`;
}

/** Zielpartei prüfen: Allianz existiert bzw. Spieler existiert und gehört keiner Allianz an. */
async function checkTarget(tx: Tx, own: string, target: string): Promise<string> {
  if (!/^[ap]:\d+$/.test(target)) fail("bad_target");
  if (target === own) fail("self");
  const t = parseParty(target);
  if (t.kind === "a") {
    const [a] = await tx.select({ id: tables.alliance.id }).from(tables.alliance).where(eq(tables.alliance.id, t.id));
    if (!a) fail("bad_target");
  } else {
    const [p] = await tx.select({ id: tables.player.id }).from(tables.player).where(eq(tables.player.id, t.id));
    if (!p) fail("bad_target");
    if (await membershipOf(tx, t.id)) fail("target_in_alliance");
  }
  return target;
}

async function lockPair(tx: Tx, a: string, b: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(7340100, hashtext(${`${a}|${b}`}))`);
}

async function row(tx: Tx, a: string, b: string, kind: "pakt" | "krieg") {
  const [r] = await tx
    .select()
    .from(tables.diplomacy)
    .where(and(eq(tables.diplomacy.partyA, a), eq(tables.diplomacy.partyB, b), eq(tables.diplomacy.kind, kind)));
  return r ?? null;
}

async function tell(tx: Tx, notes: Notes, parties: string[], subject: string, body: string): Promise<void> {
  const ids: number[] = [];
  for (const p of parties) ids.push(...(await partyMembers(tx, p)));
  await systemMessage(tx, notes, ids, subject, body);
  notes.push([ids, "alliance"]);
}

/** Pakt anbieten; hat die Gegenseite schon angeboten, gilt er sofort. Codes: at_war, pact_exists, already_offered. */
export function proposePact(engine: Engine, playerId: number, target: string) {
  return act(engine, async (tx, notes) => {
    const nowMs = Date.now();
    const own = await actorParty(tx, playerId);
    await checkTarget(tx, own, target);
    const [a, b] = pair(own, target);
    await lockPair(tx, a, b);
    await purgeExpired(tx, nowMs);
    if (await row(tx, a, b, "krieg")) fail("at_war");
    const p = await row(tx, a, b, "pakt");
    const ownName = await partyName(tx, own);
    const otherName = await partyName(tx, target);
    if (p?.status === "aktiv") fail("pact_exists");
    if (p && p.proposedBy === own) fail("already_offered");
    if (p) {
      await tx.update(tables.diplomacy).set({ status: "aktiv", activeFrom: new Date(nowMs) }).where(eq(tables.diplomacy.id, p.id));
      await tell(tx, notes, [own, target], "Diplomatie: Nichtangriffspakt",
        `${ownName} und ${otherName} haben einen Nichtangriffspakt geschlossen. Gegenseitige Überfälle sind ab sofort ausgeschlossen.`);
      return { ok: true as const, active: true };
    }
    await tx.insert(tables.diplomacy).values({ partyA: a, partyB: b, kind: "pakt", status: "angeboten", proposedBy: own });
    await tell(tx, notes, [target], "Diplomatie: Paktangebot",
      `${ownName} bietet einen Nichtangriffspakt an. Annehmen unter Truppen → Allianz → Diplomatie.`);
    notes.push([await partyMembers(tx, own), "alliance"]);
    return { ok: true as const, active: false };
  });
}

/** Pakt annehmen (nur die Seite, der er angeboten wurde). */
export function acceptPact(engine: Engine, playerId: number, id: number) {
  return act(engine, async (tx, notes) => {
    const own = await actorParty(tx, playerId);
    const [d] = await tx.select().from(tables.diplomacy).where(eq(tables.diplomacy.id, id));
    if (!d || d.kind !== "pakt" || (d.partyA !== own && d.partyB !== own)) fail("no_treaty");
    await lockPair(tx, d.partyA, d.partyB);
    const p = await row(tx, d.partyA, d.partyB, "pakt");
    if (!p || p.status !== "angeboten") fail("no_treaty");
    if (p.proposedBy === own) fail("already_offered");
    const other = p.partyA === own ? p.partyB : p.partyA;
    await tx.update(tables.diplomacy).set({ status: "aktiv", activeFrom: new Date() }).where(eq(tables.diplomacy.id, p.id));
    await tell(tx, notes, [own, other], "Diplomatie: Nichtangriffspakt",
      `${await partyName(tx, own)} und ${await partyName(tx, other)} haben einen Nichtangriffspakt geschlossen. Gegenseitige Überfälle sind ab sofort ausgeschlossen.`);
    return { ok: true as const };
  });
}

/** Angebot zurückziehen oder ablehnen; aktiven Pakt kündigen (gilt noch 24 h). */
export function cancelPact(engine: Engine, playerId: number, id: number) {
  return act(engine, async (tx, notes) => {
    const nowMs = Date.now();
    const own = await actorParty(tx, playerId);
    const [d] = await tx.select().from(tables.diplomacy).where(eq(tables.diplomacy.id, id));
    if (!d || d.kind !== "pakt" || (d.partyA !== own && d.partyB !== own)) fail("no_treaty");
    await lockPair(tx, d.partyA, d.partyB);
    const p = await row(tx, d.partyA, d.partyB, "pakt");
    if (!p) fail("no_treaty");
    const other = p.partyA === own ? p.partyB : p.partyA;
    const ownName = await partyName(tx, own);
    if (p.status === "angeboten") {
      await tx.delete(tables.diplomacy).where(eq(tables.diplomacy.id, p.id));
      await tell(tx, notes, [own, other], "Diplomatie: Paktangebot",
        p.proposedBy === own ? `${ownName} hat das Paktangebot zurückgezogen.` : `${ownName} hat das Paktangebot abgelehnt.`);
      return { ok: true as const, endsAtMs: nowMs };
    }
    if (p.endsAt) fail("already_cancelled");
    const endsAtMs = nowMs + PACT_NOTICE_MS;
    await tx.update(tables.diplomacy).set({ endsAt: new Date(endsAtMs) }).where(eq(tables.diplomacy.id, p.id));
    // Erlöschen melden (purgeExpired); spätere Zugriffe räumen ebenfalls auf, gemeldet wird nur einmal.
    await scheduleEvent(tx, "pact_expire", endsAtMs, { diplomacyId: p.id }, null);
    await tell(tx, notes, [own, other], "Diplomatie: Pakt gekündigt",
      `${ownName} hat den Nichtangriffspakt mit ${await partyName(tx, other)} gekündigt. Er gilt noch bis ${fmt(endsAtMs)} Uhr.`);
    return { ok: true as const, endsAtMs };
  });
}

/** Krieg erklären; gilt nach 12 h Vorlauf. Codes: pact_active (auch in der Kündigungsfrist), already_war. */
export function declareWar(engine: Engine, playerId: number, target: string) {
  return act(engine, async (tx, notes) => {
    const nowMs = Date.now();
    const own = await actorParty(tx, playerId);
    await checkTarget(tx, own, target);
    const [a, b] = pair(own, target);
    await lockPair(tx, a, b);
    await purgeExpired(tx, nowMs);
    if (await row(tx, a, b, "krieg")) fail("already_war");
    const p = await row(tx, a, b, "pakt");
    if (p?.status === "aktiv") fail("pact_active");
    if (p) await tx.delete(tables.diplomacy).where(eq(tables.diplomacy.id, p.id));
    const activeFromMs = nowMs + WAR_LEAD_MS;
    await tx.insert(tables.diplomacy).values({ partyA: a, partyB: b, kind: "krieg", status: "aktiv", proposedBy: own, activeFrom: new Date(activeFromMs) });
    await tell(tx, notes, [own, target], "Diplomatie: Kriegserklärung",
      `${await partyName(tx, own)} erklärt ${await partyName(tx, target)} den Krieg. Der Krieg beginnt am ${fmt(activeFromMs)} Uhr; ` +
      "ab dann entfällt bei gegenseitigen Überfällen die Schwachziel-Kürzung der Beute.");
    return { ok: true as const, activeFromMs };
  });
}

/**
 * Frieden: Die erklärende Seite kann während des Vorlaufs zurückziehen. Sonst bietet eine Seite Frieden an;
 * bietet die andere ebenfalls an, endet der Krieg.
 */
export function makePeace(engine: Engine, playerId: number, id: number) {
  return act(engine, async (tx, notes) => {
    const nowMs = Date.now();
    const own = await actorParty(tx, playerId);
    const [d] = await tx.select().from(tables.diplomacy).where(eq(tables.diplomacy.id, id));
    if (!d || d.kind !== "krieg" || (d.partyA !== own && d.partyB !== own)) fail("no_treaty");
    await lockPair(tx, d.partyA, d.partyB);
    const w = await row(tx, d.partyA, d.partyB, "krieg");
    if (!w) fail("no_treaty");
    const other = w.partyA === own ? w.partyB : w.partyA;
    const ownName = await partyName(tx, own);
    const otherName = await partyName(tx, other);
    const pending = (w.activeFrom?.getTime() ?? 0) > nowMs;
    if ((pending && w.proposedBy === own) || (w.peaceBy && w.peaceBy !== own)) {
      await tx.delete(tables.diplomacy).where(eq(tables.diplomacy.id, w.id));
      await tell(tx, notes, [own, other], "Diplomatie: Frieden",
        pending && w.proposedBy === own ? `${ownName} hat die Kriegserklärung an ${otherName} zurückgezogen.` : `${ownName} und ${otherName} haben Frieden geschlossen.`);
      return { ok: true as const, ended: true };
    }
    if (w.peaceBy === own) fail("already_offered");
    await tx.update(tables.diplomacy).set({ peaceBy: own }).where(eq(tables.diplomacy.id, w.id));
    await tell(tx, notes, [other], "Diplomatie: Friedensangebot", `${ownName} bietet Frieden an. Annehmen unter Truppen → Allianz → Diplomatie.`);
    notes.push([await partyMembers(tx, own), "alliance"]);
    return { ok: true as const, ended: false };
  });
}

/** Verträge der eigenen Partei und mögliche Gegenüber (Allianzen und Spieler ohne Allianz). */
export async function diplomacyView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  return engine.db.transaction(async (tx) => {
    await purgeExpired(tx, nowMs);
    const m = await membershipOf(tx, playerId);
    const own = m ? `a:${m.allianceId}` : `p:${playerId}`;
    const rows = await tx.select().from(tables.diplomacy).where(sql`${tables.diplomacy.partyA} = ${own} or ${tables.diplomacy.partyB} = ${own}`);
    const treaties = [];
    for (const d of rows) {
      const other = d.partyA === own ? d.partyB : d.partyA;
      treaties.push({
        id: d.id,
        kind: d.kind as "pakt" | "krieg",
        status: d.status,
        other: { party: other, name: await partyName(tx, other) },
        byUs: d.proposedBy === own,
        activeFromMs: d.activeFrom?.getTime() ?? null,
        endsAtMs: d.endsAt?.getTime() ?? null,
        peace: d.peaceBy === null ? null : d.peaceBy === own ? "wir" : "sie",
      });
    }
    const alliances = await tx.select({ id: tables.alliance.id, name: tables.alliance.name, tag: tables.alliance.tag }).from(tables.alliance).orderBy(tables.alliance.name);
    const loners = await tx.execute<{ id: number; name: string }>(sql`
      select p.id, p.name from player p where not exists (select 1 from alliance_member am where am.player_id = p.id) order by p.name`);
    const parties = [
      ...alliances.map((a) => ({ party: `a:${a.id}`, name: `[${a.tag}] ${a.name}` })),
      ...loners.map((p) => ({ party: `p:${p.id}`, name: p.name })),
    ].filter((p) => p.party !== own);
    return { serverNow: nowMs, party: own, canAct: !m || m.role !== "mitglied", treaties, parties };
  });
}
