// Seekabel (v1.21): Lesemodell für Basis → Versorgung → Seekabel. Eigenes Kabel mit Summen, offene Anfragen an
// diesen Hafen und mögliche Partner in Reichweite (eigene Häfen, Häfen von Allianzmitgliedern).
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  cableBalance, cableBufferCap, cableBuilding, cableCapacity, cableDelivered, cableSabotaged, type BaseState,
} from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { ownBase, readBase } from "./store.ts";
import { membershipOf } from "./alliance-core.ts";
import { cablesOfBase } from "./power-cable.ts";

const r1 = (x: number) => Math.round(x * 10) / 10;

function station(state: BaseState): number {
  const id = cableBuilding(balance);
  return id ? state.buildings[id] ?? 0 : 0;
}

export async function cablesView(engine: Engine, playerId: number, baseId?: number) {
  const cb = cableBalance(balance);
  const own = await ownBase(engine.db, playerId, baseId);
  const nowMs = Date.now();
  const level = station(own.state);
  const rows = cb ? await cablesOfBase(engine.db, own.id) : [];
  const names = new Map<number, string>();
  const nameOf = async (pid: number) => {
    if (!names.has(pid)) {
      const [p] = await engine.db.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, pid));
      names.set(pid, p?.name ?? "?");
    }
    return names.get(pid)!;
  };
  const cables = [];
  for (const c of rows) {
    const out = c.fromBaseId === own.id;
    const otherId = out ? c.toBaseId : c.fromBaseId;
    const other = otherId !== null ? await readBase(engine.db, otherId) : null;
    cables.push({
      id: c.id,
      role: out ? ("out" as const) : ("in" as const),
      status: c.status as "angefragt" | "aktiv",
      price: c.price,
      distanceKm: c.distanceKm,
      /** Anteil, der ankommt (1 − Leitungsverlust). */
      arrives: r1(cableDelivered(c.distanceKm, balance) * 100) / 100,
      partner: other ? { baseId: other.id, name: other.name, player: await nameOf(other.playerId), own: other.playerId === playerId } : null,
      /** Eigener Spieler hat das Kabel angeboten (bei angefragt: wartet auf die Gegenseite). */
      offeredByMe: c.fromPlayerId === playerId,
      ownPair: c.fromPlayerId === c.toPlayerId,
      delivered: r1(c.delivered),
      lost: r1(c.lost),
      paid: c.paid,
      buffer: !out && own.state.cable?.id === c.id ? r1(own.state.cable.buffer ?? 0) : null,
      bufferCap: !out ? r1(cableBufferCap(own.state, balance)) : null,
      sent: out && own.state.cable?.id === c.id ? r1(own.state.cable.sent ?? 0) : null,
      capacity: r1(cableCapacity(own.state, nowMs, balance)),
      sabotaged: cableSabotaged(own.state, nowMs, balance) || (other ? cableSabotaged(other.state, nowMs, balance) : false),
    });
  }
  // Mögliche Partner: eigene Häfen und Häfen der Allianz in Reichweite (mit Kabelstation; ohne: Hinweis).
  const candidates: { baseId: number; name: string; player: string; own: boolean; distanceKm: number; station: number; busy: boolean }[] = [];
  if (cb && cables.length === 0) {
    const m = await membershipOf(engine.db, playerId);
    const ids = [playerId];
    if (m) {
      const mates = await engine.db.select({ id: tables.allianceMember.playerId }).from(tables.allianceMember)
        .where(and(eq(tables.allianceMember.allianceId, m.allianceId), ne(tables.allianceMember.playerId, playerId)));
      ids.push(...mates.map((x) => x.id));
    }
    const bases = await engine.db.select({ id: tables.base.id, name: tables.base.name, playerId: tables.base.playerId, col: tables.base.col, row: tables.base.row, state: tables.base.state })
      .from(tables.base).where(and(inArray(tables.base.playerId, ids), ne(tables.base.id, own.id)));
    const busy = new Set<number>();
    if (bases.length > 0) {
      const used = await engine.db.select({ a: tables.powerCable.fromBaseId, b: tables.powerCable.toBaseId }).from(tables.powerCable);
      for (const u of used) for (const x of [u.a, u.b]) if (x !== null) busy.add(x);
    }
    for (const b of bases) {
      const km = hexDistanceKm(own, b);
      if (km > cb.maxKm) continue;
      candidates.push({
        baseId: b.id, name: b.name, player: await nameOf(b.playerId), own: b.playerId === playerId, distanceKm: Math.round(km),
        station: station(b.state as BaseState), busy: busy.has(b.id),
      });
    }
    candidates.sort((a, b) => Number(b.own) - Number(a.own) || a.distanceKm - b.distanceKm);
  }
  return {
    enabled: !!cb && !!cableBuilding(balance),
    station: level,
    capacity: r1(cableCapacity(own.state, nowMs, balance)),
    maxKm: cb?.maxKm ?? 0,
    maxPrice: cb?.maxPrice ?? 0,
    lossPer100Km: cb?.lossPer100Km ?? 0,
    tickMinutes: cb?.tickMinutes ?? 0,
    cables,
    candidates: candidates.slice(0, 20),
  };
}
