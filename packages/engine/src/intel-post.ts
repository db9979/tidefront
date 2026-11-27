// Lagebild Stufe 2 (5.3): mobile Radarstation. Mission „radarposten“ (Pioniere ≥ 5 und ein Landungsschiff) zu einem
// freien Küstenfeld oder eigenen Rohstofffeld; bei Ankunft entsteht der Posten (Tabelle radar_post), die Pioniere bleiben
// als Besatzung (Mission "stationed"), der Rest fährt heim. Betrieb stündlich 3 Treibstoff aus dem Hafen (radar_post_tick),
// ohne Treibstoff aus. Abbau: Besatzung fährt heim, 50 % der Kosten als Ladung. Angriff wie auf ein Feld (intel-post-attack.ts).
import { and, eq, inArray } from "drizzle-orm";
import {
  activeUnits, hasResources, postCrewCheck, postLimit, postOf, postRefund, settle, subtractCounts, subtractResources,
  type Counts, type Mission, type PostBalance,
} from "@tidefront/game-core";
import { hexDistanceKm, isCoast, isTradePortHex } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { activeMissionCount, basesOfPlayer, lockBase, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { runCommand } from "./commands.ts";
import { maxHarborLevelOf } from "./player-wide.ts";
import { insertMission, planNaval, pushNotice, sendHome, storeNavalReport, type MissionRowLike, type Notes } from "./naval-common.ts";
import type { NoticeJob } from "./context.ts";

export const POST_TYPE = "radarposten";
const HOUR_MS = 3600000;

export function postRules(): PostBalance | null {
  return postOf(balance.intel);
}

export interface PostInput {
  units: Counts;
  col: number;
  row: number;
}

/** Gründe gegen den Standort (ohne die Mission `exceptMission`). Codes: post_site, post_limit, post_too_close. */
async function siteProblem(db: DbOrTx, playerId: number, col: number, row: number, pb: PostBalance, exceptMission: number | null): Promise<{ code: string | null; fieldId: number | null }> {
  const [field] = await db.select().from(tables.resourceField).where(and(eq(tables.resourceField.col, col), eq(tables.resourceField.row, row)));
  if (field && field.ownerId !== playerId) return { code: "post_site", fieldId: null };
  if (!field) {
    if (!isCoast(col, row) || isTradePortHex(col, row)) return { code: "post_site", fieldId: null };
    const [b] = await db.select({ id: tables.base.id }).from(tables.base).where(and(eq(tables.base.col, col), eq(tables.base.row, row)));
    const [n] = await db.select({ id: tables.nest.id }).from(tables.nest).where(and(eq(tables.nest.col, col), eq(tables.nest.row, row)));
    if (b || n) return { code: "post_site", fieldId: null };
  }
  const [other] = await db.select({ id: tables.radarPost.id }).from(tables.radarPost).where(and(eq(tables.radarPost.col, col), eq(tables.radarPost.row, row)));
  if (other) return { code: "post_site", fieldId: null };
  const posts = await db.select().from(tables.radarPost).where(eq(tables.radarPost.playerId, playerId));
  const pending = (await db.select().from(tables.mission).where(and(eq(tables.mission.playerId, playerId), eq(tables.mission.type, POST_TYPE), eq(tables.mission.status, "outbound"))))
    .filter((m) => m.id !== exceptMission);
  const bases = await basesOfPlayer(db, playerId);
  if (posts.length + pending.length >= postLimit(maxHarborLevelOf(bases), pb)) return { code: "post_limit", fieldId: null };
  const spots = [...posts.map((p) => ({ col: p.col, row: p.row })), ...pending.map((m) => ({ col: m.targetCol, row: m.targetRow }))];
  if (spots.some((s) => hexDistanceKm(s, { col, row }) < pb.minDistanceKm)) return { code: "post_too_close", fieldId: null };
  return { code: null, fieldId: field?.id ?? null };
}

/** Planung: Verband, Radarstation, Standort, Kosten, Fahrt. Codes: post_off, post_crew, post_radar, post_site, … */
export async function planPost(db: DbOrTx, playerId: number, own: BaseRow, input: PostInput, nowMs: number) {
  const pb = postRules();
  const c = postCrewCheck(input.units, pb);
  if (!c.ok) throw new GameError(c.code);
  if ((own.state.buildings.radarstation ?? 0) < pb!.radarLevel) throw new GameError("post_radar");
  const site = await siteProblem(db, playerId, input.col, input.row, pb!, null);
  if (site.code) throw new GameError(site.code);
  const r = planNaval(own, {
    type: POST_TYPE, baseType: "aufklaerung", units: input.units, col: input.col, row: input.row,
    activeMissions: await activeMissionCount(db, own.id), mods: await modsOf(db, own, nowMs),
  }, nowMs);
  if (!r.ok) return r;
  if (!hasResources(r.base.resources, pb!.cost)) return { ok: false as const, code: "insufficient_resources" };
  r.base.resources = subtractResources(r.base.resources, pb!.cost);
  return { ...r, fieldId: site.fieldId, cost: pb!.cost };
}

export async function launchPost(tx: Tx, playerId: number, own: BaseRow, input: PostInput, nowMs: number, notify: Notes) {
  const r = await planPost(tx, playerId, own, input, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const missionId = await insertMission(tx, { playerId, baseId: own.id, targetKind: "post_site", targetId: r.fieldId, col: input.col, row: input.row, plan: { ...r.mission, postCost: r.cost } });
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId, arriveAtMs: r.mission.arriveAtMs };
}

/** Ankunft: Posten entsteht (Standort noch frei), Besatzung bleibt, der Rest fährt heim; sonst alles heim mit den Kosten. */
export async function postArrive(tx: Tx, m: MissionRowLike, plan: Mission & { postCost?: Record<string, number> }, due: number, notify: Notes, push: NoticeJob[]): Promise<void> {
  const pb = postRules();
  const pid = m.playerId!;
  const units = activeUnits(plan.units);
  const crewOk = pb ? postCrewCheck(units, pb) : null;
  const site = pb ? await siteProblem(tx, pid, m.targetCol, m.targetRow, pb, m.id) : { code: "post_off", fieldId: null };
  if (!pb || !crewOk?.ok || site.code) {
    const code = site.code ?? (crewOk && !crewOk.ok ? crewOk.code : "post_off");
    const reportId = await storeNavalReport(tx, { kind: "posten", title: "Radarposten nicht errichtet", attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, report: { post: { refused: code, col: m.targetCol, row: m.targetRow } }, atMs: due });
    await sendHome(tx, m, plan, units, plan.postCost ?? {}, reportId, due);
    push.push(pushNotice(pid, "report", "Radarposten nicht errichtet", "Der Verband bringt die Baustoffe zurück.", "berichte"));
    return;
  }
  const crew = crewOk.crew;
  const rest = subtractCounts(units, crew);
  const [post] = await tx.insert(tables.radarPost).values({
    playerId: pid, baseId: m.baseId!, missionId: m.id, col: m.targetCol, row: m.targetRow, fieldId: site.fieldId, crew, lastTickAt: new Date(due),
  }).returning({ id: tables.radarPost.id });
  // Besatzung bleibt auf dieser Mission (stationed); der Rest fährt als eigene Mission heim (wie beim Feld).
  const travel = Math.max(0, plan.arriveAtMs - plan.departAtMs);
  await tx.update(tables.mission).set({ status: "stationed", targetId: post.id, targetKind: "post", plan: { ...plan, units: crew }, returning: crew, cargoHome: {} }).where(eq(tables.mission.id, m.id));
  if (Object.keys(rest).length > 0) {
    const [r] = await tx.insert(tables.mission).values({
      playerId: pid, baseId: m.baseId, type: POST_TYPE, targetKind: "post", targetId: post.id, targetCol: m.targetCol, targetRow: m.targetRow,
      plan: { ...plan, units: rest, postCost: undefined }, status: "returning", returning: rest, cargoHome: {}, arriveAt: new Date(due), returnAt: new Date(due + travel),
    }).returning({ id: tables.mission.id });
    await scheduleEvent(tx, "mission_return", due + travel, { missionId: r.id }, m.baseId);
  }
  await scheduleEvent(tx, "radar_post_tick", due + HOUR_MS, { postId: post.id }, m.baseId);
  const reportId = await storeNavalReport(tx, {
    kind: "posten", title: `Radarposten ${m.targetCol}/${m.targetRow} errichtet`, attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId,
    report: { post: { id: post.id, col: m.targetCol, row: m.targetRow, crew, rangeKm: pb.rangeKm, fuelPerHour: pb.fuelPerHour } }, atMs: due,
  });
  await tx.update(tables.mission).set({ reportId }).where(eq(tables.mission.id, m.id));
  push.push(pushNotice(pid, "report", "Radarposten errichtet", `Reichweite ${pb.rangeKm} km, Betrieb ${pb.fuelPerHour} Treibstoff je Stunde.`, "karte"));
  notify.push([null, "map"], [[pid], "reports"]);
}

/** Stündlicher Betrieb: Treibstoff aus dem Hafen des Postens, sonst aus (offline). */
export async function postTick(tx: Tx, payload: Record<string, unknown>, due: number) {
  const pb = postRules();
  const [p] = await tx.select().from(tables.radarPost).where(eq(tables.radarPost.id, Number(payload.postId))).for("update");
  if (!p || !pb) return { notify: [] };
  const b = await lockBase(tx, p.baseId);
  let offline = true;
  if (b) {
    const s = settle(b.state, due, balance, await modsOf(tx, b, due));
    if ((s.resources.treibstoff ?? 0) >= pb.fuelPerHour) {
      s.resources = subtractResources(s.resources, { treibstoff: pb.fuelPerHour });
      await saveBase(tx, b.id, s);
      offline = false;
    }
  }
  await tx.update(tables.radarPost).set({ offline, lastTickAt: new Date(due) }).where(eq(tables.radarPost.id, p.id));
  await scheduleEvent(tx, "radar_post_tick", due + HOUR_MS, { postId: p.id }, p.baseId);
  return { notify: [[[p.playerId], "base"]] as [number[], "base"][] };
}

/** Besatzung eines Postens heimschicken (Abbau mit Rückerstattung oder nach Zerstörung ohne Überlebende). */
export async function sendCrewHome(tx: Tx, missionId: number | null, survivors: Counts, cargo: Record<string, number>, due: number): Promise<number> {
  if (missionId === null) return due;
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, missionId)).for("update");
  if (!m || m.status !== "stationed") return due;
  const plan = m.plan as Mission;
  const left = activeUnits(survivors);
  const returnAt = Object.keys(left).length === 0 && Object.keys(cargo).length === 0 ? due : due + Math.max(0, plan.arriveAtMs - plan.departAtMs);
  await tx.update(tables.mission).set({ status: "returning", returning: left, cargoHome: cargo, returnAt: new Date(returnAt) }).where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
  return returnAt;
}

/** Abbauen: Besatzung kehrt mit 50 % der Kosten heim, der Posten verschwindet. Codes: no_post. */
export function dismantlePost(engine: Engine, playerId: number, key: string, postId: number) {
  return runCommand<{ ok: true; returnAtMs: number }>(engine, playerId, key, "postDismantle", async (ctx) => {
    const pb = postRules();
    const [p] = await ctx.tx.select().from(tables.radarPost).where(eq(tables.radarPost.id, postId)).for("update");
    if (!p || p.playerId !== playerId || !pb) throw new GameError("no_post");
    const returnAtMs = await sendCrewHome(ctx.tx, p.missionId, p.crew as Counts, postRefund(pb), ctx.nowMs);
    await ctx.tx.delete(tables.radarPost).where(eq(tables.radarPost.id, p.id));
    ctx.notify.push([[playerId], "missions"], [[playerId], "base"], [null, "map"]);
    return { ok: true as const, returnAtMs };
  });
}

/** Eigene Posten (Verwaltung im Lagebild-Reiter). */
export async function ownPosts(db: DbOrTx, members: number[]) {
  if (members.length === 0) return [];
  return db.select().from(tables.radarPost).where(inArray(tables.radarPost.playerId, members));
}
