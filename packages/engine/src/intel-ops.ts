// Lagebild Stufe 2: Einstieg für Patrouille, Aufklärungskampagne, Radarposten (errichten, angreifen, abbauen).
// Befehle intel.launch / intel.preview, eigene Ereignisse (patrol_tick, patrol_end, radar_post_tick) und der Eingriff
// in die Missionsankunft (handlers.ts: withIntelArrive). Regeln: docs/REGELN-LAGEBILD.md 5.3–5.5, 5.7.
import { eq } from "drizzle-orm";
import type { Counts, Mission } from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { GameError, type Engine, type NoticeJob } from "./context.ts";
import type { EventRow, Handler, HandlerResult } from "./events.ts";
import { runCommand } from "./commands.ts";
import { lockOwnBase, ownBase, type BaseRow } from "./store.ts";
import type { MissionRowLike, Notes } from "./naval-common.ts";
import { PATROL_TYPE, endPatrolAt, launchPatrol, patrolArrive, patrolEnd, patrolTick, planPatrol } from "./intel-patrol.ts";
import { campaignContinue, launchCampaign, planCampaign, scoutSighted } from "./intel-campaign.ts";
import { POST_TYPE, launchPost, planPost, postArrive, postTick } from "./intel-post.ts";
import { launchPostAttack, postAttackArrive, previewPostAttack } from "./intel-post-attack.ts";
import type { PatrolPlan } from "./intel-route.ts";
import { satelliteEnd, satellitePass } from "./intel-sat-pass.ts"; // Stufe 3: Satelliten

export type IntelOp = "patrouille" | "kampagne" | "radarposten" | "postenangriff";

export interface IntelOpInput {
  op: IntelOp;
  units: Counts;
  baseId?: number;
  waypoints?: { col: number; row: number }[];
  hours?: number;
  targets?: { col: number; row: number }[];
  col?: number;
  row?: number;
  postId?: number;
}

function need<T>(v: T | undefined, code = "bad_input"): T {
  if (v === undefined) throw new GameError(code);
  return v;
}

async function plan(db: DbOrTx, playerId: number, own: BaseRow, i: IntelOpInput, nowMs: number) {
  switch (i.op) {
    case "patrouille": return planPatrol(db, playerId, own, { units: i.units, waypoints: need(i.waypoints, "patrol_waypoints"), hours: need(i.hours, "patrol_hours") }, nowMs);
    case "kampagne": return planCampaign(db, playerId, own, { units: i.units, targets: need(i.targets, "campaign_targets") }, nowMs);
    case "radarposten": return planPost(db, playerId, own, { units: i.units, col: need(i.col), row: need(i.row) }, nowMs);
    case "postenangriff": return previewPostAttack(db, playerId, own, { units: i.units, postId: need(i.postId, "no_post") }, nowMs);
    default: throw new GameError("bad_type");
  }
}

/** Vorschau (gleiche Prüfungen wie der Start, ohne Änderung): Fahrt, Treibstoff, Zeiten. */
export async function previewIntelOp(engine: Engine, playerId: number, i: IntelOpInput) {
  const nowMs = Date.now();
  try {
    const own = await ownBase(engine.db, playerId, i.baseId);
    const r = await plan(engine.db, playerId, own, i, nowMs);
    if (!r.ok) return { ok: false as const, code: r.code };
    const m = r.mission as Mission & { patrol?: PatrolPlan };
    const far = i.op === "patrouille" ? Math.max(0, ...(i.waypoints ?? []).map((w) => hexDistanceKm(own, w))) : m.distanceKm;
    return {
      ok: true as const, distanceKm: Math.round(far), travelSeconds: m.travelSeconds, fuelCost: m.fuelCost,
      arriveAtMs: m.arriveAtMs, returnAtMs: m.returnAtMs, sightKm: m.patrol?.sightKm ?? null, sonarKm: m.patrol?.sonarKm ?? null,
      cost: "cost" in r ? r.cost : null,
    };
  } catch (err) {
    if (err instanceof GameError) return { ok: false as const, code: err.code };
    throw err;
  }
}

/** Start einer Lagebild-Mission aus dem eigenen (aktiven) Hafen. */
export function launchIntelOp(engine: Engine, playerId: number, key: string, i: IntelOpInput) {
  return runCommand<{ ok: true; missionId: number; arriveAtMs: number }>(engine, playerId, key, `intel:${i.op}`, async (ctx) => {
    const own = await lockOwnBase(ctx.tx, playerId, i.baseId);
    switch (i.op) {
      case "patrouille": return launchPatrol(ctx.tx, playerId, own, { units: i.units, waypoints: need(i.waypoints, "patrol_waypoints"), hours: need(i.hours, "patrol_hours") }, ctx.nowMs, ctx.notify);
      case "kampagne": return launchCampaign(ctx.tx, playerId, own, { units: i.units, targets: need(i.targets, "campaign_targets") }, ctx.nowMs, ctx.notify);
      case "radarposten": return launchPost(ctx.tx, playerId, own, { units: i.units, col: need(i.col), row: need(i.row) }, ctx.nowMs, ctx.notify);
      case "postenangriff": return launchPostAttack(ctx.tx, playerId, own, { units: i.units, postId: need(i.postId, "no_post") }, ctx.nowMs, ctx.notify);
      default: throw new GameError("bad_type");
    }
  });
}

/** Patrouille vorzeitig heimholen (auf Station; auf der Hinfahrt gilt der normale Rückruf). Codes: no_mission. */
export function endPatrol(engine: Engine, playerId: number, key: string, missionId: number) {
  return runCommand<{ ok: true; returnAtMs: number }>(engine, playerId, key, "patrolEnd", async (ctx) => {
    const [m] = await ctx.tx.select({ playerId: tables.mission.playerId }).from(tables.mission).where(eq(tables.mission.id, missionId));
    if (!m || m.playerId !== playerId) throw new GameError("no_mission");
    const at = await endPatrolAt(ctx.tx, missionId, ctx.nowMs);
    if (at === null) throw new GameError("no_mission");
    ctx.notify.push([[playerId], "missions"]);
    return { ok: true as const, returnAtMs: at };
  });
}

export const INTEL_HANDLERS: Record<string, Handler> = {
  patrol_tick: (tx, ev, due) => patrolTick(tx, ev.payload, due) as Promise<HandlerResult>,
  patrol_end: (tx, ev, due) => patrolEnd(tx, ev.payload, due) as Promise<HandlerResult>,
  radar_post_tick: (tx, ev, due) => postTick(tx, ev.payload, due) as Promise<HandlerResult>,
  satellite_pass: (tx, ev, due) => satellitePass(tx, ev.payload, due), // Stufe 3
  satellite_end: (tx, ev, due) => satelliteEnd(tx, ev.payload, due),
};

/** Eigene Ankünfte (Patrouille, Radarposten, Angriff auf einen Posten); null = normale Ankunft. */
async function intelArrive(tx: Tx, m: MissionRowLike & { plan: unknown }, due: number): Promise<HandlerResult | null> {
  if (m.playerId === null) return null;
  const notify: Notes = [[[m.playerId], "missions"], [[m.playerId], "base"]];
  const push: NoticeJob[] = [];
  const plan = m.plan as Mission;
  if (m.type === PATROL_TYPE) await patrolArrive(tx, m, plan as Mission & { patrol: PatrolPlan }, due, notify);
  else if (m.type === POST_TYPE) await postArrive(tx, m, plan, due, notify, push);
  else if (m.targetKind === "post") await postAttackArrive(tx, m, plan, due, notify, push);
  else return null;
  return { notify, push };
}

/** Eingriff in mission_arrive: eigene Arten vorher, danach Kampagne (nächstes Ziel) und „Aufklärer gesichtet“. */
export function withIntelArrive(inner: Handler): Handler {
  return async (tx: Tx, ev: EventRow, due: number) => {
    const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, Number(ev.payload.missionId))).for("update");
    if (!m || m.status !== "outbound") return inner(tx, ev, due);
    const own = await intelArrive(tx, m, due);
    if (own) return own;
    const res = await inner(tx, ev, due);
    if (m.type === "aufklaerung") {
      const push: NoticeJob[] = [];
      await scoutSighted(tx, m, due, push);
      await campaignContinue(tx, m.id, due);
      return { ...res, push: [...(res.push ?? []), ...push] };
    }
    return res;
  };
}
