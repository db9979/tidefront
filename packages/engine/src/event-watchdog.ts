// Wächter der Ereignis-Queue (Worker, alle 10 Minuten). Ein Ereignis, das MAX_EVENT_ATTEMPTS-mal scheitert, ist
// "failed"; mit ihm enden Ketten, die sich im Handler selbst neu einplanen (Kartell raid_launch, Radarposten-Takt,
// Seekabel-Abrechnung, Satelliten-Überflug, Patrouillen-Takt), und Missionen bleiben auf outbound/returning stehen
// (Missionsplatz belegt). Der Wächter legt fehlende Folgeereignisse neu an. Jede Reparatur läuft in einer eigenen
// Transaktion: Objekt sperren, dann erneut prüfen, ob inzwischen ein offenes Ereignis besteht (kein Doppel).
// Missionen, deren Ankunft wiederholt scheiterte (REPAIR_GIVE_UP fehlgeschlagene Ereignisse), werden nicht noch
// einmal ankommen gelassen, sondern ohne Ziel heimgeschickt (Kartell: aufgelöst).
import { and, eq, inArray, sql } from "drizzle-orm";
import { activeSatellites, nextPass, type BaseState, type Mission } from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { lockBase, scheduleEvent } from "./store.ts";
import { MAP_WIDTH_KM } from "./intel-sat.ts";
import { PATROL_TYPE } from "./intel-patrol.ts";
import { CABLE_TICK } from "./power-cable.ts";
import type { PatrolPlan } from "./intel-route.ts";

const HOUR_MS = 3600000;
/** Ab so vielen gescheiterten Ereignissen einer Mission: heimschicken statt erneut ankommen lassen. */
export const REPAIR_GIVE_UP = 2;

export interface WatchdogResult {
  missions: number;
  sentHome: number;
  chains: Record<string, number>;
}

type Key = string;
const key = (type: string, id: unknown): Key => `${type}:${String(id)}`;

/** Offene Ereignisse als Schlüssel type:id (id aus payload[field]). */
async function pendingKeys(tx: Tx | Engine["db"], field: string): Promise<Set<Key>> {
  const rows = await tx.execute<{ type: string; id: string }>(sql`
    select type, payload->>${field} as id from game_event where status = 'pending' and payload ? ${field}`);
  return new Set(rows.map((r) => key(r.type, r.id)));
}

/** Offenes Ereignis zu payload[field] = id (beliebiger Typ, wenn types leer). */
async function hasPending(tx: Tx, field: string, id: number, types: string[] = []): Promise<boolean> {
  const rows = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from game_event where status = 'pending' and payload->>${field} = ${String(id)}
    ${types.length ? sql`and type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``}`);
  return (rows[0]?.n ?? 0) > 0;
}

/** Ereignistyp der Ankunft einer Mission. */
function arriveEventOf(m: { playerId: number | null; type: string; targetKind: string; targetId: number | null }): { type: string; baseId: number | null } {
  if (m.playerId === null) return { type: "raid_arrive", baseId: m.targetId };
  if (m.type === "spionage") return { type: "spy_arrive", baseId: m.targetKind === "base" ? m.targetId : null };
  return { type: "mission_arrive", baseId: m.targetKind === "base" ? m.targetId : null };
}

/** Missionen auf outbound/returning ohne offenes Ereignis: Ankunft bzw. Rückkehr neu einplanen. */
async function repairMissions(engine: Engine, nowMs: number, out: WatchdogResult): Promise<void> {
  const db = engine.db;
  const candidates = await db.execute<{ id: number }>(sql`
    select m.id from mission m
    where m.status in ('outbound', 'returning')
      and not (m.plan ? 'allianceRaidId')
      and not exists (select 1 from game_event e where e.status = 'pending' and e.payload->>'missionId' = m.id::text)`);
  if (candidates.length === 0) return;
  const failedRows = await db.execute<{ id: string; n: number }>(sql`
    select payload->>'missionId' as id, count(*)::int as n from game_event
    where status = 'failed' and payload ? 'missionId' group by 1`);
  const failed = new Map(failedRows.map((r) => [Number(r.id), r.n]));
  for (const { id } of candidates) {
    await db.transaction(async (tx) => {
      const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, Number(id))).for("update");
      if (!m || (m.status !== "outbound" && m.status !== "returning")) return;
      if (await hasPending(tx, "missionId", m.id)) return;
      const plan = m.plan as Mission;
      if (m.status === "returning") {
        const due = Math.max(m.returnAt?.getTime() ?? nowMs, nowMs);
        if (m.baseId === null) {
          await tx.update(tables.mission).set({ status: "done" }).where(eq(tables.mission.id, m.id));
        } else {
          await tx.update(tables.mission).set({ returnAt: new Date(due) }).where(eq(tables.mission.id, m.id));
          await scheduleEvent(tx, "mission_return", due, { missionId: m.id }, m.baseId);
        }
        out.missions++;
      } else if ((failed.get(m.id) ?? 0) >= REPAIR_GIVE_UP) {
        // Ankunft scheitert wiederholt: ohne Ziel heim (Fahrzeit der Hinfahrt), Kartell löst sich auf.
        if (m.baseId === null) {
          await tx.update(tables.mission).set({ status: "done" }).where(eq(tables.mission.id, m.id));
        } else {
          const travel = Math.max(0, (plan.arriveAtMs ?? nowMs) - (plan.departAtMs ?? nowMs));
          const returnAt = nowMs + travel;
          await tx.update(tables.mission)
            .set({ status: "returning", returning: { ...(plan.units ?? {}) }, cargoHome: {}, returnAt: new Date(returnAt) })
            .where(eq(tables.mission.id, m.id));
          await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
        }
        out.sentHome++;
      } else {
        const ev = arriveEventOf(m);
        await scheduleEvent(tx, ev.type, Math.max(m.arriveAt.getTime(), nowMs), { missionId: m.id }, ev.baseId);
        out.missions++;
      }
      engine.log("watchdog mission", { missionId: m.id, status: m.status });
    });
  }
}

/** Patrouillen auf Station: Ende (patrol_end) und Takt (patrol_tick) müssen offen sein. */
async function repairPatrols(engine: Engine, nowMs: number, out: WatchdogResult): Promise<void> {
  const pending = await pendingKeys(engine.db, "missionId");
  const rows = await engine.db.select({ id: tables.mission.id }).from(tables.mission)
    .where(and(eq(tables.mission.status, "holding"), eq(tables.mission.type, PATROL_TYPE)));
  for (const { id } of rows) {
    if (pending.has(key("patrol_end", id)) && pending.has(key("patrol_tick", id))) continue;
    await engine.db.transaction(async (tx) => {
      const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, id)).for("update");
      if (!m || m.status !== "holding") return;
      const p = (m.plan as { patrol?: PatrolPlan }).patrol;
      const endMs = p?.endMs ?? nowMs;
      if (!(await hasPending(tx, "missionId", m.id, ["patrol_end"]))) {
        await scheduleEvent(tx, "patrol_end", Math.max(endMs, nowMs), { missionId: m.id }, null);
        out.chains.patrol_end = (out.chains.patrol_end ?? 0) + 1;
      }
      if (endMs > nowMs && !(await hasPending(tx, "missionId", m.id, ["patrol_tick"]))) {
        await scheduleEvent(tx, "patrol_tick", nowMs, { missionId: m.id }, null);
        out.chains.patrol_tick = (out.chains.patrol_tick ?? 0) + 1;
      }
    });
  }
}

/** Kette über eine Zeilen-ID (radar_post_tick, cable_tick): Zeile sperren, offenes Ereignis prüfen, anlegen. */
async function repairRowChain(
  engine: Engine, out: WatchdogResult, type: string, field: string, ids: { id: number; baseId: number | null }[],
  lockRow: (tx: Tx, id: number) => Promise<boolean>, dueMs: number,
): Promise<void> {
  const pending = await pendingKeys(engine.db, field);
  for (const r of ids) {
    if (pending.has(key(type, r.id))) continue;
    await engine.db.transaction(async (tx) => {
      if (!(await lockRow(tx, r.id))) return;
      if (await hasPending(tx, field, r.id, [type])) return;
      await scheduleEvent(tx, type, dueMs, { [field]: r.id }, r.baseId);
      out.chains[type] = (out.chains[type] ?? 0) + 1;
      engine.log("watchdog chain", { type, id: r.id });
    });
  }
}

/** Kartell-Überfälle: jeder Hafen hat genau eine offene raid_launch-Kette (nach einer Pause von raidIntervalHours). */
async function repairRaids(engine: Engine, nowMs: number, out: WatchdogResult): Promise<void> {
  const rows = await engine.db.execute<{ id: number }>(sql`
    select b.id from base b where not exists (
      select 1 from game_event e where e.status = 'pending' and e.type = 'raid_launch' and e.base_id = b.id)`);
  for (const { id } of rows) {
    await engine.db.transaction(async (tx) => {
      const b = await lockBase(tx, id);
      if (!b) return;
      const [p] = await tx.select({ n: sql<number>`count(*)::int` }).from(tables.gameEvent)
        .where(and(eq(tables.gameEvent.status, "pending"), eq(tables.gameEvent.type, "raid_launch"), eq(tables.gameEvent.baseId, id)));
      if ((p?.n ?? 0) > 0) return;
      await scheduleEvent(tx, "raid_launch", nowMs + balance.pirates.raidIntervalHours * HOUR_MS, {}, id);
      out.chains.raid_launch = (out.chains.raid_launch ?? 0) + 1;
      engine.log("watchdog chain", { type: "raid_launch", baseId: id });
    });
  }
}

/** Satelliten: nächster Überflug und Ende müssen offen sein (verpasste Überflüge werden nicht nachgeholt). */
async function repairSatellites(engine: Engine, nowMs: number, out: WatchdogResult): Promise<void> {
  const pending = await pendingKeys(engine.db, "satId");
  const bases = await engine.db.select({ id: tables.base.id, state: tables.base.state }).from(tables.base)
    .where(sql`jsonb_array_length(coalesce(${tables.base.state}->'satellites', '[]'::jsonb)) > 0`);
  for (const row of bases) {
    const sats = activeSatellites(row.state as BaseState, nowMs);
    if (sats.every((s) => pending.has(key("satellite_end", s.id)) && (pending.has(key("satellite_pass", s.id)) || !nextPass(s, nowMs, MAP_WIDTH_KM)))) continue;
    await engine.db.transaction(async (tx) => {
      const b = await lockBase(tx, row.id);
      if (!b) return;
      for (const s of activeSatellites(b.state, nowMs)) {
        const next = nextPass(s, nowMs, MAP_WIDTH_KM);
        if (next && !(await hasPending(tx, "satId", s.id, ["satellite_pass"]))) {
          await scheduleEvent(tx, "satellite_pass", next.startMs, { baseId: b.id, satId: s.id, k: next.k }, b.id);
          out.chains.satellite_pass = (out.chains.satellite_pass ?? 0) + 1;
        }
        if (!(await hasPending(tx, "satId", s.id, ["satellite_end"]))) {
          await scheduleEvent(tx, "satellite_end", s.expiresAtMs, { baseId: b.id, satId: s.id }, b.id);
          out.chains.satellite_end = (out.chains.satellite_end ?? 0) + 1;
        }
      }
    });
  }
}

/** Sammelangriffe: offen → alliance_raid_launch zur Frist, ausgelaufen → alliance_raid_arrive zur Ankunft. */
async function repairAllianceRaids(engine: Engine, nowMs: number, out: WatchdogResult): Promise<void> {
  const pending = await pendingKeys(engine.db, "raidId");
  const raids = await engine.db.select().from(tables.allianceRaid).where(inArray(tables.allianceRaid.status, ["offen", "ausgelaufen"]));
  for (const r of raids) {
    const type = r.status === "offen" ? "alliance_raid_launch" : "alliance_raid_arrive";
    if (pending.has(key(type, r.id))) continue;
    await engine.db.transaction(async (tx) => {
      const [x] = await tx.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, r.id)).for("update");
      if (!x || x.status !== r.status || (await hasPending(tx, "raidId", x.id, [type]))) return;
      const due = type === "alliance_raid_launch" ? x.joinDeadline.getTime() : (x.arriveAt?.getTime() ?? nowMs);
      await scheduleEvent(tx, type, Math.max(due, nowMs), { raidId: x.id }, type === "alliance_raid_arrive" && x.targetKind === "base" ? x.targetId : null);
      out.chains[type] = (out.chains[type] ?? 0) + 1;
      engine.log("watchdog chain", { type, raidId: x.id });
    });
  }
}

/** Ein Lauf des Wächters. Fehler einzelner Teile brechen die übrigen nicht ab. */
export async function runEventWatchdog(engine: Engine, nowMs: number): Promise<WatchdogResult> {
  const out: WatchdogResult = { missions: 0, sentHome: 0, chains: {} };
  const steps: [string, () => Promise<void>][] = [
    ["missions", () => repairMissions(engine, nowMs, out)],
    ["patrols", () => repairPatrols(engine, nowMs, out)],
    ["raids", () => repairRaids(engine, nowMs, out)],
    ["radar posts", async () => {
      const posts = await engine.db.select({ id: tables.radarPost.id, baseId: tables.radarPost.baseId }).from(tables.radarPost);
      await repairRowChain(engine, out, "radar_post_tick", "postId", posts, async (tx, id) => {
        const [p] = await tx.select({ id: tables.radarPost.id }).from(tables.radarPost).where(eq(tables.radarPost.id, id)).for("update");
        return !!p;
      }, nowMs);
    }],
    ["cables", async () => {
      const cables = await engine.db.select({ id: tables.powerCable.id, baseId: tables.powerCable.toBaseId }).from(tables.powerCable)
        .where(eq(tables.powerCable.status, "aktiv"));
      await repairRowChain(engine, out, CABLE_TICK, "cableId", cables, async (tx, id) => {
        const [c] = await tx.select({ status: tables.powerCable.status }).from(tables.powerCable).where(eq(tables.powerCable.id, id)).for("update");
        return c?.status === "aktiv";
      }, nowMs);
    }],
    ["satellites", () => repairSatellites(engine, nowMs, out)],
    ["alliance raids", () => repairAllianceRaids(engine, nowMs, out)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err) {
      engine.log("watchdog step failed", { step: name, error: String(err) });
    }
  }
  return out;
}
