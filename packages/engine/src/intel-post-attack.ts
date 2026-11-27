// Lagebild Stufe 2 (5.3): Angriff auf einen fremden Radarposten (wie auf ein Rohstofffeld). Mission „ueberfall“ mit
// Zielart "post". Der Posten verteidigt sich mit seiner Besatzung; die Anlage (20 Lebenspunkte) fällt mit ihr. Gewinnt
// der Angreifer (Truppen gelandet, Besatzung geschlagen), ist der Posten zerstört und die Pioniere sind verloren.
import { eq } from "drizzle-orm";
import {
  activeUnits, attackerReturning, combineModifiers, resolveBattle, type AttackerInput, type Counts, type Mission,
} from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type NoticeJob } from "./context.ts";
import { activeMissionCount, randomSeed, readBase, saveBase, withSite, type BaseRow } from "./store.ts";
import { modifiersFor, modsOf } from "./modifiers.ts";
import { battleWeather } from "./weather.ts";
import { diplomacyBlock } from "./alliance-core.ts";
import { insertMission, planNaval, playerName, pushNotice, sendHome, storeNavalReport, type MissionRowLike, type Notes } from "./naval-common.ts";
import { postRules, sendCrewHome } from "./intel-post.ts";

export interface PostAttackInput {
  units: Counts;
  postId: number;
}

async function planPostAttack(db: DbOrTx, playerId: number, own: BaseRow, input: PostAttackInput, nowMs: number) {
  if (!postRules()) throw new GameError("post_off");
  const [p] = await db.select().from(tables.radarPost).where(eq(tables.radarPost.id, input.postId));
  if (!p) throw new GameError("no_post");
  if (p.playerId === playerId) throw new GameError("own_post");
  const d = await diplomacyBlock(db, playerId, p.playerId, nowMs);
  if (d) throw new GameError(d);
  // Schutzregeln wie beim Feld: Schutz des Hafens, dem der Posten gehört.
  const home = await readBase(db, p.baseId);
  const r = planNaval(own, {
    type: "ueberfall", baseType: "ueberfall", units: input.units, col: p.col, row: p.row,
    activeMissions: await activeMissionCount(db, own.id), mods: await modsOf(db, own, nowMs),
    targetProtection: home ? withSite(home.state, home.col, home.row).protection : undefined,
  }, nowMs);
  return { r, post: p };
}

export async function launchPostAttack(tx: Tx, playerId: number, own: BaseRow, input: PostAttackInput, nowMs: number, notify: Notes) {
  const { r, post } = await planPostAttack(tx, playerId, own, input, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const missionId = await insertMission(tx, { playerId, baseId: own.id, targetKind: "post", targetId: post.id, col: post.col, row: post.row, plan: r.mission });
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId, arriveAtMs: r.mission.arriveAtMs };
}

export async function previewPostAttack(db: DbOrTx, playerId: number, own: BaseRow, input: PostAttackInput, nowMs: number) {
  const { r } = await planPostAttack(db, playerId, own, input, nowMs);
  return r;
}

/** Ankunft am Posten: Kampf gegen die Besatzung. */
export async function postAttackArrive(tx: Tx, m: MissionRowLike, plan: Mission, due: number, notify: Notes, push: NoticeJob[]): Promise<void> {
  const pid = m.playerId!;
  const units = activeUnits(plan.units);
  const [p] = m.targetId !== null ? await tx.select().from(tables.radarPost).where(eq(tables.radarPost.id, m.targetId)).for("update") : [];
  const refused = !p ? "no_post" : await diplomacyBlock(tx, pid, p.playerId, due);
  if (!p || refused) {
    const reportId = await storeNavalReport(tx, { kind: "posten", title: "Radarposten nicht angetroffen", attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, report: { post: { refused: refused ?? "no_post", col: m.targetCol, row: m.targetRow } }, atMs: due });
    await sendHome(tx, m, plan, units, {}, reportId, due);
    return;
  }
  const origin = m.baseId !== null ? await readBase(tx, m.baseId) : null;
  const owner = await readBase(tx, p.baseId);
  const attacker: AttackerInput = {
    units, versorgungsmangel: origin?.state.versorgungsmangel ?? false,
    modifiers: await modifiersFor(tx, pid, { state: origin?.state ?? null, nowMs: due, baseId: origin?.id, isHome: origin?.isHome }),
  };
  const crew = activeUnits(p.crew as Counts);
  const seed = randomSeed();
  const res = resolveBattle(attacker, { units: crew, defenses: {}, modifiers: combineModifiers(owner ? await modsOf(tx, owner, due) : undefined) }, balance, seed, battleWeather(p.col, p.row, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const report = res.report;
  const destroyed = report.winner === "attacker";
  const left = activeUnits(report.defender.final);
  if (destroyed) {
    await sendCrewHome(tx, p.missionId, {}, {}, due); // Pioniere verloren
    await tx.delete(tables.radarPost).where(eq(tables.radarPost.id, p.id));
  } else {
    await tx.update(tables.radarPost).set({ crew: left }).where(eq(tables.radarPost.id, p.id));
    if (p.missionId !== null) await tx.update(tables.mission).set({ returning: left }).where(eq(tables.mission.id, p.missionId));
  }
  const attackerName = await playerName(tx, pid);
  const ownerName = await playerName(tx, p.playerId);
  const name = `Radarposten ${p.col}/${p.row}`;
  const title = destroyed ? `${name} zerstört` : `Angriff auf ${name} abgewiesen`;
  const reportId = await storeNavalReport(tx, {
    kind: "posten", title, attackerPlayerId: pid, defenderPlayerId: p.playerId, attackerBaseId: m.baseId, defenderBaseId: p.baseId,
    winner: report.winner, seed, atMs: due,
    report: { post: { id: p.id, col: p.col, row: p.row, destroyed, hp: postRules()?.hp ?? 20 }, battle: { ...report, loot: {} }, attackerName, defenderName: ownerName, targetName: name, attacker },
  });
  await sendHome(tx, m, plan, attackerReturning(report), {}, reportId, due);
  push.push(pushNotice(pid, "report", title, destroyed ? "Die Besatzung ist geschlagen." : "Der Verband kehrt heim.", "berichte"));
  push.push(pushNotice(p.playerId, "attack", destroyed ? `${name} verloren` : `${name} gehalten`, `Angreifer: ${attackerName}.`, "berichte"));
  notify.push([null, "map"], [[pid], "reports"], [[p.playerId], "reports"], [[p.playerId], "missions"]);
}
