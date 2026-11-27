// Mehrere Häfen: Häfen verwalten – umbenennen, Kolonie aufgeben, Name einer neuen Kolonie aus der Karte
// (docs/REGELN-EXPANSION.md, Abschnitte „Hafen umbenennen“ und „Kolonie aufgeben“).
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { settle } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { runCommand } from "./commands.ts";
import { basesOfPlayer, homeBaseOf, lockOwnBase, ownBase, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { incomingDetected } from "./views.ts";
import { normalizeBaseName } from "./harbor-names.ts";
import { systemMessage } from "./world-events.ts";
import { STATION_TYPE } from "./alliance-ops-station.ts";
import { amounts, nameOf } from "./names.ts";

function fail(code: string): never {
  throw new GameError(code);
}

// ---------------------------------------------------------------- Umbenennen

/** Eigenen Hafen umbenennen. Codes: bad_base_name, base_name_taken, no_base. */
export function renameBase(engine: Engine, playerId: number, key: string, baseId: number | undefined, rawName: string) {
  return runCommand<{ ok: true; name: string }>(engine, playerId, key, "baseRename", async (ctx) => {
    const name = normalizeBaseName(rawName);
    if (!name) fail("bad_base_name");
    const b = await lockOwnBase(ctx.tx, playerId, baseId);
    const others = (await basesOfPlayer(ctx.tx, playerId)).filter((o) => o.id !== b.id);
    if (others.some((o) => o.name.toLowerCase() === name.toLowerCase())) fail("base_name_taken");
    await ctx.tx.update(tables.base).set({ name }).where(eq(tables.base.id, b.id));
    // Laufende Belagerung zeigt den Namen des Hafens (world_event.data.baseName).
    await ctx.tx.update(tables.worldEvent)
      .set({ data: sql`jsonb_set(${tables.worldEvent.data}, '{baseName}', to_jsonb(${name}::text))` })
      .where(and(eq(tables.worldEvent.targetBaseId, b.id), inArray(tables.worldEvent.status, ["announced", "active"])));
    ctx.notify.push([[playerId], "base"], [null, "map"]);
    return { ok: true as const, name };
  });
}

// ---------------------------------------------------------------- Kolonie aufgeben

/**
 * Gründe gegen das Aufgeben einer Kolonie (leer = erlaubt). Nur, was der Spieler selbst sieht oder steuert:
 * home_base, missions_out (eigene Verbände von dort unterwegs, gebunden oder stationiert), incoming_own (eigene
 * Verlegung/Transport dorthin), attack_incoming (vom Radar erfasster Angriff), guests_stationed (verbündete Verbände
 * dort oder auf dem Weg), blockaded, under_siege, deliveries_underway (Börse, Spielerhandel, Feldertrag),
 * offers_open (Handelsangebote aus diesem Hafen), field_held (Rohstofffeld liefert dorthin).
 */
export async function abandonBlockers(db: DbOrTx, playerId: number, b: BaseRow, nowMs: number): Promise<string[]> {
  if (b.isHome) return ["home_base"];
  const out: string[] = [];
  const count = async (q: Promise<{ n: number }[]>) => ((await q)[0]?.n ?? 0) > 0;
  const n = sql<number>`count(*)::int`;
  if (await count(db.select({ n }).from(tables.mission).where(and(
    eq(tables.mission.baseId, b.id), inArray(tables.mission.status, ["outbound", "returning", "staged", "stationed", "holding"]),
  )))) out.push("missions_out");
  if (await count(db.select({ n }).from(tables.mission).where(and(
    eq(tables.mission.playerId, playerId), eq(tables.mission.targetId, b.id), inArray(tables.mission.targetKind, ["base", "own_base"]),
    eq(tables.mission.status, "outbound"),
  )))) out.push("incoming_own");
  const mods = await modsOf(db, b, nowMs);
  if (await incomingDetected(db, b.id, settle(b.state, nowMs, balance, mods), nowMs, mods)) out.push("attack_incoming");
  if (await count(db.select({ n }).from(tables.mission).where(and(
    eq(tables.mission.type, STATION_TYPE), eq(tables.mission.targetId, b.id), inArray(tables.mission.status, ["outbound", "stationed"]),
    ne(tables.mission.playerId, playerId),
  )))) out.push("guests_stationed");
  if (await count(db.select({ n }).from(tables.blockade).where(and(eq(tables.blockade.targetBaseId, b.id), eq(tables.blockade.status, "active"))))) out.push("blockaded");
  if (await count(db.select({ n }).from(tables.worldEvent).where(and(
    eq(tables.worldEvent.targetBaseId, b.id), inArray(tables.worldEvent.status, ["announced", "active"]),
  )))) out.push("under_siege");
  const deliveries = await count(db.select({ n }).from(tables.delivery).where(and(eq(tables.delivery.baseId, b.id), eq(tables.delivery.status, "underway"))));
  const convoys = await count(db.select({ n }).from(tables.convoy).where(and(eq(tables.convoy.recipientBaseId, b.id), eq(tables.convoy.status, "underway"))));
  if (deliveries || convoys) out.push("deliveries_underway");
  if (await count(db.select({ n }).from(tables.playerOffer).where(and(eq(tables.playerOffer.sellerBaseId, b.id), eq(tables.playerOffer.status, "open"))))) out.push("offers_open");
  if (await count(db.select({ n }).from(tables.resourceField).where(eq(tables.resourceField.baseId, b.id)))) out.push("field_held");
  return out;
}

/** Vorschau „Kolonie aufgeben“ für den Client: Hinderungsgründe und was verfällt. */
export async function abandonInfo(engine: Engine, playerId: number, baseId?: number) {
  const nowMs = Date.now();
  const b = await ownBase(engine.db, playerId, baseId);
  const s = settle(b.state, nowMs, balance, await modsOf(engine.db, b, nowMs));
  const [adm] = await engine.db.select({ n: sql<number>`count(*)::int` }).from(tables.admiral).where(eq(tables.admiral.baseId, b.id));
  return {
    baseId: b.id,
    name: b.name,
    isHome: b.isHome,
    blockers: await abandonBlockers(engine.db, playerId, b, nowMs),
    /** Verfällt: Bestände, Einheiten daheim, Verteidigung; Admirale wechseln in den Heimathafen. */
    resources: Object.fromEntries(Object.entries(s.resources).map(([k, v]) => [k, Math.floor(v)])),
    units: Object.fromEntries(Object.entries(s.units).filter(([, v]) => v > 0)),
    defenses: Object.fromEntries(Object.entries(s.defenses).filter(([, v]) => v > 0)),
    buildingLevels: Object.values(s.buildings).reduce((a, v) => a + v, 0),
    admirals: adm?.n ?? 0,
  };
}

/**
 * Kolonie aufgeben (nie der Heimathafen; baseId Pflicht). Bestände, Gebäude, Schlangen, Einheiten und Verteidigung
 * verfallen; Admirale dieses Hafens wechseln in den Heimathafen; eigene Minenfelder bleiben (ohne Hafen). Unerkannte
 * feindliche Verbände finden kein Ziel mehr und kehren um; ein anfahrender Kartell-Überfall entfällt.
 * Codes: no_base, home_base und die Gründe aus abandonBlockers.
 */
export function abandonColony(engine: Engine, playerId: number, key: string, baseId: number) {
  return runCommand<{ ok: true; homeBaseId: number }>(engine, playerId, key, "baseAbandon", async (ctx) => {
    const { tx, nowMs } = ctx;
    const b = await lockOwnBase(tx, playerId, baseId);
    const blockers = await abandonBlockers(tx, playerId, b, nowMs);
    if (blockers.length > 0) fail(blockers[0]);
    const home = await homeBaseOf(tx, playerId);
    if (!home) fail("no_base");
    const s = settle(b.state, nowMs, balance, await modsOf(tx, b, nowMs));
    await tx.update(tables.admiral).set({ baseId: home.id }).where(eq(tables.admiral.baseId, b.id));
    await tx.update(tables.minefield).set({ baseId: null }).where(eq(tables.minefield.baseId, b.id));
    // Kartell-Überfälle auf den Hafen entfallen (eigene Zeilen ohne Spieler); Spieler-Verbände drehen bei Ankunft um.
    await tx.update(tables.mission).set({ status: "done" }).where(and(
      isNull(tables.mission.playerId), eq(tables.mission.targetKind, "base"), eq(tables.mission.targetId, b.id), eq(tables.mission.status, "outbound"),
    ));
    // Ereignisse des Hafens selbst (Bau, Ausbildung, Kartell-Planung); Missions- und Lieferereignisse bleiben.
    await tx.delete(tables.gameEvent).where(and(
      eq(tables.gameEvent.baseId, b.id), eq(tables.gameEvent.status, "pending"),
      inArray(tables.gameEvent.type, ["build_complete", "training_complete", "raid_launch", "attack_warning"]),
    ));
    // mission (base_id) und Missionsverlauf dieses Hafens fallen per Kaskade; Rohstofffelder sind oben ausgeschlossen.
    await tx.delete(tables.base).where(eq(tables.base.id, b.id));
    const lost = Object.entries(s.units).filter(([, v]) => v > 0).map(([id, v]) => `${v} × ${nameOf(id)}`);
    await systemMessage(tx, [playerId], `Außenposten ${b.name} aufgegeben`,
      `Du hast den Außenposten ${b.name} (Feld ${b.col}/${b.row}) aufgegeben. Verfallen sind die Bestände (${amounts(s.resources)})` +
      `${lost.length ? `, die Einheiten (${lost.join(", ")})` : ""} und alle Gebäude. Admirale des Hafens dienen jetzt im Heimathafen ${home.name}.`, nowMs);
    ctx.notify.push([[playerId], "base"], [[playerId], "missions"], [[playerId], "messages"], [null, "map"]);
    return { ok: true as const, homeBaseId: home.id };
  });
}
