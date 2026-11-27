// Weltpolitik: Seerat (docs/REGELN-WELTPOLITIK.md, Abschnitt 5). Abstimmen ist ein Befehl (runCommand mit
// Idempotenzschlüssel); die Stimme ist geheim und bis zum Schluss änderbar. Auszählung: tallySeerat (game-core) mit
// den aktiven Menschen, ihren Allianzen und den KI-Spielern (zusammen 1 Stimme).
import { and, eq, inArray } from "drizzle-orm";
import { politikOf, tallySeerat, type SeeratTally } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { runCommand } from "./commands.ts";
import { activeHumans, politikKis, politikOff } from "./politik-core.ts";

type SitzungRow = typeof tables.seeratSitzung.$inferSelect;

function fail(code: string): never {
  throw new GameError(code);
}

/** Auszählen (ohne zu speichern): Stimmen, Allianzen, KI-Stimmen, Quorum über die aktiven Menschen. */
export async function tallySitzung(db: DbOrTx, s: SitzungRow, nowMs: number): Promise<SeeratTally> {
  const cfg = politikOf(balance)!.seerat;
  const votes = await db.select().from(tables.seeratStimme).where(eq(tables.seeratStimme.sitzungId, s.id));
  const ids = votes.map((v) => v.playerId);
  const members = ids.length === 0 ? [] : await db.select().from(tables.allianceMember).where(inArray(tables.allianceMember.playerId, ids));
  const ally = new Map(members.map((m) => [m.playerId, m.allianceId]));
  const kis = await politikKis(db);
  const humans = await activeHumans(db, nowMs);
  return tallySeerat({
    options: s.options as string[],
    ballots: votes.map((v) => ({ playerId: v.playerId, option: v.option, allianceId: ally.get(v.playerId) ?? null })),
    kis: kis.map((k) => ({ kiId: k.id, name: k.name, profile: k.profile })),
    activeHumans: humans.length,
    fallback: s.kind === "fenster" ? "plan" : "ruhig",
    cfg,
  });
}

/**
 * Stimme abgeben oder ändern, solange die Sitzung offen ist. Nur Menschen mit Hafen.
 * Codes: no_session, session_closed, bad_option, no_base, bot, seerat_off.
 */
export function seeratVote(engine: Engine, playerId: number, key: string, input: { sitzungId: number; option: string }) {
  return runCommand<{ ok: true; option: string }>(engine, playerId, key, "seeratVote", async (ctx) => {
    if (!politikOf(balance)) fail("seerat_off");
    if ((await politikOff(ctx.tx)).seerat) fail("seerat_off");
    const [p] = await ctx.tx.select({ bot: tables.player.botProfile }).from(tables.player).where(eq(tables.player.id, playerId));
    if (!p || p.bot !== null) fail("bot");
    const [b] = await ctx.tx.select({ id: tables.base.id }).from(tables.base).where(eq(tables.base.playerId, playerId)).limit(1);
    if (!b) fail("no_base");
    const [s] = await ctx.tx.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.id, input.sitzungId)).for("update");
    if (!s) fail("no_session");
    const open = s.opensAt.getTime() <= ctx.nowMs && ctx.nowMs < s.closesAt.getTime() && (s.status === "offen" || s.status === "geplant");
    if (!open) fail("session_closed");
    if (!(s.options as string[]).includes(input.option)) fail("bad_option");
    await ctx.tx.insert(tables.seeratStimme).values({ sitzungId: s.id, playerId, option: input.option, createdAt: new Date(ctx.nowMs) })
      .onConflictDoUpdate({ target: [tables.seeratStimme.sitzungId, tables.seeratStimme.playerId], set: { option: input.option, createdAt: new Date(ctx.nowMs) } });
    ctx.notify.push([[playerId], "season"]);
    return { ok: true as const, option: input.option };
  });
}

/** Eigene Stimmen zu Sitzungen (für die Ansicht: nur die eigene, nie fremde). */
export async function ownVotes(db: DbOrTx, playerId: number, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(tables.seeratStimme).where(and(eq(tables.seeratStimme.playerId, playerId), inArray(tables.seeratStimme.sitzungId, ids)));
  return new Map(rows.map((r) => [r.sitzungId, r.option]));
}

/** Zahl der bisher abgegebenen Stimmen einer offenen Sitzung (ohne Verteilung: geheim bis zum Schluss). */
export async function voteCount(tx: Tx | DbOrTx, sitzungId: number): Promise<number> {
  return (await tx.select({ p: tables.seeratStimme.playerId }).from(tables.seeratStimme).where(eq(tables.seeratStimme.sitzungId, sitzungId))).length;
}
