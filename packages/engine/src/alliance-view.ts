// Lesemodelle der Allianzen: eigene Allianz mit Mitgliedern und Anfragen, Verzeichnis aller Allianzen mit
// Allianzwertung (Summe der Mitgliederpunkte aus der Rangliste), Kürzel und Beziehungen je Spieler.
import { desc, eq, sql } from "drizzle-orm";
import { tables } from "@tidefront/db";
import type { Engine } from "./context.ts";
import { ALLIANCE_MAX_SETTING, allianceMaxSize, membershipOf, purgeExpired, type Role } from "./alliance-core.ts";
import { rankingView } from "./social.ts";
import { setSetting } from "./settings.ts";

type ReqKind = "einladung" | "anfrage";
/** Offene Einladungen/Anfragen des Spielers ohne Allianz. */
type Invitation = { id: number; kind: ReqKind; atMs: number; alliance: { id: number; name: string; tag: string } };
/** Offene Einladungen/Anfragen der Allianz (nur für Führung und Offiziere). */
type JoinRequest = { id: number; kind: ReqKind; atMs: number; player: { id: number; name: string } };

async function pointsByPlayer(engine: Engine, playerId: number): Promise<Map<number, number>> {
  const r = await rankingView(engine, playerId);
  return new Map(r.rows.map((x) => [x.playerId, x.total]));
}

/** Eigene Allianz (oder null) mit Mitgliedern, offenen Anfragen; ohne Allianz die eigenen Einladungen/Anfragen. */
export async function allianceView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const m = await membershipOf(engine.db, playerId);
  const maxSize = await allianceMaxSize(engine.db);
  if (!m) {
    const reqs = await engine.db
      .select({ id: tables.allianceRequest.id, kind: tables.allianceRequest.kind, createdAt: tables.allianceRequest.createdAt, allianceId: tables.alliance.id, name: tables.alliance.name, tag: tables.alliance.tag })
      .from(tables.allianceRequest)
      .innerJoin(tables.alliance, eq(tables.alliance.id, tables.allianceRequest.allianceId))
      .where(eq(tables.allianceRequest.playerId, playerId))
      .orderBy(desc(tables.allianceRequest.createdAt));
    return {
      serverNow: nowMs,
      maxSize,
      alliance: null,
      invitations: reqs.map((r): Invitation => ({ id: r.id, kind: r.kind as ReqKind, atMs: r.createdAt.getTime(), alliance: { id: r.allianceId, name: r.name, tag: r.tag } })),
      requests: [] as JoinRequest[],
    };
  }
  const [a] = await engine.db.select().from(tables.alliance).where(eq(tables.alliance.id, m.allianceId));
  const pts = await pointsByPlayer(engine, playerId);
  const members = await engine.db
    .select({ playerId: tables.allianceMember.playerId, role: tables.allianceMember.role, joinedAt: tables.allianceMember.joinedAt, name: tables.player.name })
    .from(tables.allianceMember)
    .innerJoin(tables.player, eq(tables.player.id, tables.allianceMember.playerId))
    .where(eq(tables.allianceMember.allianceId, m.allianceId));
  const officer = m.role !== "mitglied";
  const reqs = officer
    ? await engine.db
        .select({ id: tables.allianceRequest.id, kind: tables.allianceRequest.kind, createdAt: tables.allianceRequest.createdAt, playerId: tables.player.id, name: tables.player.name })
        .from(tables.allianceRequest)
        .innerJoin(tables.player, eq(tables.player.id, tables.allianceRequest.playerId))
        .where(eq(tables.allianceRequest.allianceId, m.allianceId))
        .orderBy(desc(tables.allianceRequest.createdAt))
    : [];
  const order: Record<string, number> = { fuehrung: 0, offizier: 1, mitglied: 2 };
  const list = members
    .map((x) => ({ playerId: x.playerId, name: x.name, role: x.role as Role, joinedAtMs: x.joinedAt.getTime(), points: pts.get(x.playerId) ?? 0, own: x.playerId === playerId }))
    .sort((x, y) => order[x.role] - order[y.role] || y.points - x.points || x.name.localeCompare(y.name, "de"));
  return {
    serverNow: nowMs,
    maxSize,
    alliance: {
      id: a.id,
      name: a.name,
      tag: a.tag,
      description: a.description,
      createdAtMs: a.createdAt.getTime(),
      role: m.role,
      points: list.reduce((s, x) => s + x.points, 0),
      members: list,
    },
    invitations: [] as Invitation[],
    requests: reqs.map((r): JoinRequest => ({ id: r.id, kind: r.kind as ReqKind, atMs: r.createdAt.getTime(), player: { id: r.playerId, name: r.name } })),
  };
}

export type Relation = "verbuendet" | "pakt" | "pakt_gekuendigt" | "pakt_angeboten" | "krieg" | "krieg_angekuendigt";

/**
 * Verzeichnis: alle Allianzen mit Allianzwertung (Rang nach Summe der Mitgliederpunkte), Kürzel je Spieler und
 * die Beziehung der eigenen Partei zu jedem anderen Spieler.
 */
export async function allianceDirectory(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  await purgeExpired(engine.db, nowMs);
  const pts = await pointsByPlayer(engine, playerId);
  const alliances = await engine.db.select().from(tables.alliance);
  const members = await engine.db.select().from(tables.allianceMember);
  const own = members.find((x) => x.playerId === playerId);
  const ownParty = own ? `a:${own.allianceId}` : `p:${playerId}`;
  const byAlliance = new Map<number, number[]>();
  for (const x of members) byAlliance.set(x.allianceId, [...(byAlliance.get(x.allianceId) ?? []), x.playerId]);
  const rows = alliances.map((a) => {
    const ids = byAlliance.get(a.id) ?? [];
    return { id: a.id, name: a.name, tag: a.tag, description: a.description, members: ids.length, total: ids.reduce((s, id) => s + (pts.get(id) ?? 0), 0), own: own?.allianceId === a.id };
  });
  rows.sort((x, y) => y.total - x.total || x.name.localeCompare(y.name, "de"));
  let rank = 0;
  const ranked = rows.map((r, i) => {
    if (i === 0 || r.total !== rows[i - 1].total) rank = i + 1;
    return { ...r, rank };
  });
  const tagOf = new Map(alliances.map((a) => [a.id, a.tag]));
  const players: Record<number, { allianceId: number; tag: string; role: Role }> = {};
  for (const x of members) players[x.playerId] = { allianceId: x.allianceId, tag: tagOf.get(x.allianceId) ?? "", role: x.role as Role };

  const relations: Record<number, Relation> = {};
  if (own) for (const id of byAlliance.get(own.allianceId) ?? []) if (id !== playerId) relations[id] = "verbuendet";
  const treaties = await engine.db.select().from(tables.diplomacy).where(sql`${tables.diplomacy.partyA} = ${ownParty} or ${tables.diplomacy.partyB} = ${ownParty}`);
  for (const d of treaties) {
    const other = d.partyA === ownParty ? d.partyB : d.partyA;
    const [k, raw] = other.split(":");
    const ids = k === "a" ? byAlliance.get(Number(raw)) ?? [] : [Number(raw)];
    const rel: Relation = d.kind === "krieg"
      ? ((d.activeFrom?.getTime() ?? 0) <= nowMs ? "krieg" : "krieg_angekuendigt")
      : d.status === "angeboten" ? "pakt_angeboten" : d.endsAt ? "pakt_gekuendigt" : "pakt";
    for (const id of ids) relations[id] = rel;
  }
  return { serverNow: nowMs, alliances: ranked, players, relations };
}

/** Verwaltung: Höchstgröße einer Allianz (2–50). Bestehende größere Allianzen bleiben, nehmen aber niemanden auf. */
export async function setAllianceMaxSize(engine: Engine, size: number) {
  await setSetting(engine.db, ALLIANCE_MAX_SETTING, String(Math.max(2, Math.min(50, Math.floor(size)))));
  engine.notify(null, "alliance");
  return { ok: true as const, maxSize: await allianceMaxSize(engine.db) };
}
