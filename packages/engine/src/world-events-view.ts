// Weltereignisse: Lesemodell für Karte, Info-Blatt und Banner auf der Basis.
import { desc, eq, gt, inArray } from "drizzle-orm";
import { routePosition, worldEventsBalance, type Counts, type ResourceMap } from "@tidefront/game-core";
import { hexAtLonLat, hexDistanceKm } from "@tidefront/world";
import { tables } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { baseOfPlayer } from "./store.ts";
import { openWorldEvents, siegeEffects, type WorldEventRow } from "./world-events.ts";

const HOUR_MS = 3600000;

function reward(ev: WorldEventRow): ResourceMap {
  if (ev.kind === "schatzschiff") return ev.data.loot ?? {};
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(ev.data.lootPool ?? {})) out[r] = Math.max(0, Math.floor(v - (ev.data.paid?.[r] ?? 0)));
  return out;
}

/** Aktuelles Feld: Schatzschiff aus der Route zum Zeitpunkt, sonst gespeichert. */
function position(ev: WorldEventRow, nowMs: number): { col: number; row: number } {
  if (ev.kind === "schatzschiff" && ev.data.route && ev.data.route.length > 0) {
    const p = routePosition(ev.data.route, nowMs);
    return hexAtLonLat(p.lon, p.lat);
  }
  return { col: ev.col, row: ev.row };
}

export async function worldEventsView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const w = worldEventsBalance(balance);
  const open = await openWorldEvents(engine.db);
  // Kürzlich beendete Ereignisse (6 h) für Karte und Banner: „aufgebracht“, „gebrochen“, „entkommen“.
  const recent = (await engine.db
    .select()
    .from(tables.worldEvent)
    .where(gt(tables.worldEvent.endedAt, new Date(nowMs - 6 * HOUR_MS)))
    .orderBy(desc(tables.worldEvent.endedAt))
    .limit(5)) as WorldEventRow[];
  const all = [...open, ...recent.filter((r) => r.status === "ended")];
  const own = await baseOfPlayer(engine.db, playerId);
  const ids = all.map((e) => e.id);
  const damage = ids.length === 0 ? [] : await engine.db
    .select({ eventId: tables.worldEventDamage.eventId, playerId: tables.worldEventDamage.playerId, hp: tables.worldEventDamage.hp, attacks: tables.worldEventDamage.attacks, name: tables.player.name })
    .from(tables.worldEventDamage)
    .innerJoin(tables.player, eq(tables.player.id, tables.worldEventDamage.playerId))
    .where(inArray(tables.worldEventDamage.eventId, ids));
  const winners = all.map((e) => e.winnerPlayerId).filter((x): x is number => x !== null);
  const names = new Map<number, string>();
  if (winners.length > 0) {
    for (const p of await engine.db.select({ id: tables.player.id, name: tables.player.name }).from(tables.player).where(inArray(tables.player.id, winners))) names.set(p.id, p.name);
  }
  const events = all.map((e) => {
    const pos = e.status === "ended" ? { col: e.col, row: e.row } : position(e, nowMs);
    const mine = damage.filter((d) => d.eventId === e.id);
    return {
      id: e.id,
      kind: e.kind,
      status: e.status,
      outcome: e.outcome,
      col: pos.col,
      row: pos.row,
      startsAtMs: e.startsAt.getTime(),
      activeAtMs: e.activeAt.getTime(),
      endsAtMs: e.endsAt.getTime(),
      units: e.units as Counts,
      initialUnits: e.initialUnits as Counts,
      reward: reward(e),
      path: e.data.path ?? null,
      route: e.data.route ?? null,
      harbor: e.data.harbor ?? null,
      region: e.data.region ?? null,
      targets: (e.data.targets ?? []).map((t) => ({ name: t.name, col: t.col, row: t.row, status: t.status, own: t.playerId === playerId, winner: t.winner ?? null })),
      siege: e.kind === "belagerung" ? { baseId: e.targetBaseId, name: e.data.baseName ?? "?", own: e.data.ownerId === playerId, penalty: w.belagerung.productionPenalty } : null,
      winner: e.winnerPlayerId !== null ? names.get(e.winnerPlayerId) ?? "?" : null,
      contributors: mine.sort((a, b) => b.hp - a.hp).map((d) => ({ name: d.name, hp: d.hp, attacks: d.attacks, own: d.playerId === playerId })),
      distanceKm: own ? Math.round(hexDistanceKm(own, pos)) : null,
    };
  });
  const siege = own ? await siegeEffects(engine.db, own.id, nowMs) : null;
  const nearby = events
    .filter((e) => e.status !== "ended" && e.distanceKm !== null && (e.distanceKm <= w.nearbyKm || e.targets.some((t) => t.own)))
    .map((e) => e.id);
  return { serverNow: nowMs, events, ownSiege: siege, nearby };
}
