// See: Konvois – Spielerhandel-Lieferungen und Transporte reisen als Konvoi. Das Kartell fängt gelegentlich ab
// (Würfel beim Auslaufen), Kriegsgegner mit einer Abfangmission. Geleitschutz kämpft; ohne ihn geht Ladung verloren
// (docs/REGELN-SEE.md, Abschnitt Konvois).
import { and, eq, gt, inArray } from "drizzle-orm";
import {
  activeUnits,
  buildRoute,
  cargoValue,
  cartelConvoyForce,
  cartelRoll,
  convoyPlunder,
  convoysOf,
  distanceKm,
  fleetTotals,
  interceptPoint,
  resolveBattle,
  routePosition,
  slowestSpeedKmh,
  splitCargo,
  strandTroops,
  type AttackerInput,
  type Counts,
  type Mission,
  type ResourceMap,
} from "@tidefront/game-core";
import { hexAtLonLat, hexCenter } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type NoticeJob } from "./context.ts";
import { activeMissionCount, randomSeed, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import { modifiersFor, modsOf } from "./modifiers.ts";
import { battleWeather } from "./weather.ts";
import { atWar } from "./alliance-core.ts";
import { resText } from "./world-events.ts";
import {
  activeCounts, hasShips, insertMission, planNaval, playerName, pushNotice, sendHome, storeNavalReport,
  type MissionRowLike, type NavalInput, type Notes,
} from "./naval-common.ts";

export interface ConvoyRow {
  id: number;
  kind: string;
  deliveryId: string | null;
  missionId: number | null;
  senderId: number | null;
  recipientId: number;
  recipientBaseId: number;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  cargo: unknown;
  escort: unknown;
  escortMissionId: number | null;
  cartelAt: Date | null;
  events: unknown;
  status: string;
  departAt: Date;
  arriveAt: Date;
}

type ConvoyEvent = { atMs: number; by: "kartell" | "spieler"; name: string; lost: ResourceMap; escortHeld: boolean | null };

const route = (c: ConvoyRow) => buildRoute([hexCenter(c.fromCol, c.fromRow), hexCenter(c.toCol, c.toRow)], c.departAt.getTime(), c.arriveAt.getTime());

/** Legt einen Konvoi an und würfelt einmal, ob (und wann) das Kartell abfängt. */
export async function createConvoy(
  tx: Tx,
  v: {
    kind: "handel" | "transport" | "feld"; deliveryId?: string; missionId?: number; senderId: number | null; recipientId: number; recipientBaseId: number; // Felder: "feld"
    from: { col: number; row: number }; to: { col: number; row: number }; cargo: ResourceMap; escort?: Counts; departMs: number; arriveMs: number;
  },
): Promise<number> {
  const c = convoysOf(balance);
  const dist = distanceKm(hexCenter(v.from.col, v.from.row), hexCenter(v.to.col, v.to.row));
  const roll = c ? cartelRoll(randomSeed(), dist, cargoValue(v.cargo, balance), balance) : null;
  const cartelAt = roll?.hit ? Math.round(v.departMs + (v.arriveMs - v.departMs) * roll.atShare) : null;
  const [row] = await tx.insert(tables.convoy).values({
    kind: v.kind, deliveryId: v.deliveryId ?? null, missionId: v.missionId ?? null, senderId: v.senderId, recipientId: v.recipientId,
    recipientBaseId: v.recipientBaseId, fromCol: v.from.col, fromRow: v.from.row, toCol: v.to.col, toRow: v.to.row,
    cargo: v.cargo, escort: activeCounts(v.escort ?? {}), cartelAt: cartelAt === null ? null : new Date(cartelAt),
    departAt: new Date(v.departMs), arriveAt: new Date(v.arriveMs),
  }).returning({ id: tables.convoy.id });
  if (cartelAt !== null) await scheduleEvent(tx, "convoy_raid", cartelAt, { convoyId: row.id }, null);
  return row.id;
}

/**
 * Geleitschutz für eine eingehende Handelslieferung: eigene Schiffe fahren der Lieferung entgegen und kommen mit ihr
 * heim (Treibstoff für Hin- und Rückweg, belegt einen Missionsplatz). Codes: escort_ships_only und die der Planung.
 */
export async function attachTradeEscort(tx: Tx, playerId: number, own: BaseRow, units: Counts, convoyId: number, from: { col: number; row: number }, arriveMs: number, nowMs: number) {
  const escort = activeCounts(units);
  if (Object.keys(escort).length === 0) return null;
  if (Object.keys(escort).some((id) => balance.units[id]?.branch !== "see")) throw new GameError("escort_ships_only");
  const r = planNaval(own, {
    type: "geleit", baseType: "aufklaerung", units: escort, col: from.col, row: from.row,
    activeMissions: await activeMissionCount(tx, own.id), mods: await modsOf(tx, own, nowMs),
  }, nowMs);
  if (!r.ok) throw new GameError(r.code);
  await saveBase(tx, own.id, r.base);
  const plan = { ...r.mission, arriveAtMs: arriveMs, returnAtMs: arriveMs, convoyId };
  const missionId = await insertMission(tx, { playerId, baseId: own.id, targetKind: "convoy", targetId: convoyId, col: from.col, row: from.row, plan });
  await tx.update(tables.convoy).set({ escort, escortMissionId: missionId }).where(eq(tables.convoy.id, convoyId));
  return missionId;
}

async function lockConvoy(tx: Tx, where: { id?: number; missionId?: number; deliveryId?: string }): Promise<ConvoyRow | null> {
  const t = tables.convoy;
  const cond = where.id !== undefined ? eq(t.id, where.id) : where.missionId !== undefined ? eq(t.missionId, where.missionId) : eq(t.deliveryId, where.deliveryId!);
  const [c] = await tx.select().from(t).where(cond).for("update");
  return (c as ConvoyRow) ?? null;
}

/** Geleit, das wirklich mitfährt: beim Transport der Verband selbst, beim Handel nur, solange die Geleitmission läuft. */
async function liveEscort(tx: Tx, c: ConvoyRow): Promise<Counts> {
  if (c.kind === "transport") return activeCounts(c.escort as Counts);
  if (c.escortMissionId === null) return {};
  const [m] = await tx.select({ status: tables.mission.status }).from(tables.mission).where(eq(tables.mission.id, c.escortMissionId));
  return m?.status === "outbound" ? activeCounts(c.escort as Counts) : {};
}

/** Ladungsverlust buchen: Konvoi, Lieferung und Journal (delivery:<id> → account). */
async function takeCargo(tx: Tx, c: ConvoyRow, lost: ResourceMap, account: string, atMs: number): Promise<void> {
  const cargo = { ...(c.cargo as ResourceMap) };
  for (const [r, q] of Object.entries(lost)) cargo[r] = Math.max(0, (cargo[r] ?? 0) - q);
  c.cargo = cargo;
  await tx.update(tables.convoy).set({ cargo }).where(eq(tables.convoy.id, c.id));
  if (c.deliveryId) {
    const [d] = await tx.select().from(tables.delivery).where(eq(tables.delivery.id, c.deliveryId)).for("update");
    const q = lost[d?.resource ?? ""] ?? 0;
    if (d && q > 0) {
      await tx.update(tables.delivery).set({ qty: Math.max(0, d.qty - q) }).where(eq(tables.delivery.id, d.id));
      const tradeId = `cv-${c.id}:${account}:${atMs}`;
      await tx.insert(tables.tradeLedger).values([
        { tradeId, tMs: atMs, account: `delivery:${d.id}`, asset: d.resource, amount: (-q).toFixed(2) },
        { tradeId, tMs: atMs, account, asset: d.resource, amount: q.toFixed(2) },
      ]);
    }
  }
}

/** Seekampf gegen das Geleit (Angreifer: Kartell oder Spieler). Rückgabe: Geleit hält, Bericht, Überlebende. */
async function fightEscort(tx: Tx, c: ConvoyRow, attacker: AttackerInput, escort: Counts, due: number) {
  const ownerId = c.kind === "transport" ? c.senderId : (await escortOwner(tx, c));
  const seed = randomSeed();
  const at = routePosition(route(c), due);
  const hex = hexAtLonLat(at.lon, at.lat);
  const res = resolveBattle(attacker, { units: escort, defenses: {}, modifiers: ownerId !== null ? await modifiersFor(tx, ownerId, { nowMs: due }) : {} }, balance, seed, battleWeather(hex.col, hex.row, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const { report, destroyed } = strandTroops(res.report, balance);
  const left = activeUnits(report.defender.final);
  c.escort = left;
  await tx.update(tables.convoy).set({ escort: left }).where(eq(tables.convoy.id, c.id));
  return { held: !destroyed, report: { ...report, loot: {} }, seed, attackerLeft: activeUnits(report.attacker.final), hex };
}

async function escortOwner(tx: Tx, c: ConvoyRow): Promise<number | null> {
  if (c.escortMissionId === null) return null;
  const [m] = await tx.select({ playerId: tables.mission.playerId }).from(tables.mission).where(eq(tables.mission.id, c.escortMissionId));
  return m?.playerId ?? null;
}

async function addEvent(tx: Tx, c: ConvoyRow, e: ConvoyEvent): Promise<void> {
  const events = [...((c.events as ConvoyEvent[]) ?? []), e];
  c.events = events;
  await tx.update(tables.convoy).set({ events }).where(eq(tables.convoy.id, c.id));
}

/** Wer den Bericht als „Verteidiger“ sieht: Empfänger (Handel) bzw. Absender (Transport). */
const victimOf = (c: ConvoyRow) => (c.kind === "transport" ? c.senderId! : c.recipientId);

/** game_event convoy_raid: Kartellverband greift den Konvoi an. */
export async function convoyRaidHandler(tx: Tx, payload: Record<string, unknown>, due: number) {
  const notify: Notes = [];
  const push: NoticeJob[] = [];
  const c = await lockConvoy(tx, { id: Number(payload.convoyId) });
  const cb = convoysOf(balance);
  if (!c || !cb || c.status !== "underway" || due >= c.arriveAt.getTime()) return { notify };
  const value = cargoValue(c.cargo as ResourceMap, balance);
  const force = cartelConvoyForce(value, balance);
  const escort = await liveEscort(tx, c);
  let held: boolean | null = null;
  let battle: unknown = null;
  let seed: number | null = null;
  if (hasShips(escort)) {
    const f = await fightEscort(tx, c, { units: force }, escort, due);
    held = f.held;
    battle = f.report;
    seed = f.seed;
  }
  const share = held === true ? 0 : held === false ? cb.lossShareEscortBeaten : cb.lossShareUnescorted;
  const { lost } = splitCargo(c.cargo as ResourceMap, share);
  if (Object.keys(lost).length > 0) await takeCargo(tx, c, lost, "kartell", due);
  await addEvent(tx, c, { atMs: due, by: "kartell", name: "Freibeuter-Kartell", lost, escortHeld: held });
  const victim = victimOf(c);
  const title = held === true ? "Konvoi: Geleitschutz schlägt das Kartell zurück" : `Konvoi vom Kartell abgefangen – ${resText(lost)} verloren`;
  await storeNavalReport(tx, {
    kind: "konvoi", title, attackerPlayerId: null, defenderPlayerId: victim, defenderBaseId: c.recipientBaseId, winner: held === null ? null : held ? "defender" : "attacker", seed,
    report: { convoy: { id: c.id, kind: c.kind, by: "kartell", force, escort, held, lost, cargoLeft: c.cargo }, ...(battle ? { battle, attackerName: "Freibeuter-Kartell", defenderName: "Geleitschutz", targetName: "Konvoi" } : {}) },
    atMs: due,
  });
  push.push(pushNotice(victim, "delivery", title, held === true ? "Die Ladung ist sicher." : `Verlust: ${resText(lost)}.`, "berichte"));
  notify.push([[victim], "reports"], [[victim], "base"], [[victim], "market"]);
  return { notify, push };
}

// ---------------------------------------------------------------- Abfangen durch Kriegsgegner

async function planIntercept(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number) {
  const [c] = (await db.select().from(tables.convoy).where(eq(tables.convoy.id, input.convoyId!))) as ConvoyRow[];
  if (!c || c.status !== "underway" || c.arriveAt.getTime() <= nowMs) throw new GameError("no_convoy");
  if (c.recipientId === playerId || c.senderId === playerId) throw new GameError("own_convoy");
  const enemy = (await atWar(db, playerId, c.recipientId, nowMs)) || (c.senderId !== null && (await atWar(db, playerId, c.senderId, nowMs)));
  if (!enemy) throw new GameError("convoy_not_enemy");
  const speed = slowestSpeedKmh(input.units, balance);
  if (speed === null || !hasShips(input.units)) throw new GameError("intercept_needs_ships");
  const hit = interceptPoint(route(c), hexCenter(own.col, own.row), speed, nowMs);
  if (!hit || hit.atMs >= c.arriveAt.getTime()) throw new GameError("intercept_impossible");
  const h = hexAtLonLat(hit.point.lon, hit.point.lat);
  const r = planNaval(own, {
    type: "abfangen", baseType: "ueberfall", units: input.units, col: h.col, row: h.row,
    activeMissions: await activeMissionCount(db, own.id), mods: await modsOf(db, own, nowMs),
  }, nowMs);
  if (!r.ok) return r;
  if (r.mission.arriveAtMs >= c.arriveAt.getTime()) return { ok: false as const, code: "too_late" };
  return { ...r, convoy: c, intercept: h };
}

export async function launchIntercept(tx: Tx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number, notify: Notes) {
  const r = await planIntercept(tx, playerId, own, input, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const missionId = await insertMission(tx, { playerId, baseId: own.id, targetKind: "convoy", targetId: r.convoy.id, col: r.intercept.col, row: r.intercept.row, plan: r.mission });
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId, arriveAtMs: r.mission.arriveAtMs };
}

export async function previewIntercept(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number) {
  const r = await planIntercept(db, playerId, own, input, nowMs);
  if (!r.ok) return r;
  return { ok: true as const, mission: r.mission, extra: { intercept: r.intercept, convoyCargo: r.convoy.cargo as ResourceMap, escorted: hasShips(r.convoy.escort as Counts) } };
}

/** Ankunft am Abfangpunkt: Kampf gegen das Geleit, bei Sieg (oder ohne Geleit) Beute aus der Ladung. */
export async function interceptArrive(tx: Tx, m: MissionRowLike, plan: Mission, units: Counts, origin: BaseRow | null, due: number, notify: Notes, push: NoticeJob[]): Promise<void> {
  const pid = m.playerId!;
  const c = await lockConvoy(tx, { id: m.targetId! });
  if (!c || c.status !== "underway" || due >= c.arriveAt.getTime() || !hasShips(units)) {
    const reportId = await storeNavalReport(tx, {
      kind: "konvoi", title: "Konvoi verpasst – schon eingelaufen", attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId,
      report: { convoy: { id: m.targetId, missed: true } }, atMs: due,
    });
    await sendHome(tx, m, plan, units, {}, reportId, due);
    return;
  }
  const mods = await modifiersFor(tx, pid, { state: origin?.state ?? null, nowMs: due });
  const escort = await liveEscort(tx, c);
  let held: boolean | null = null;
  let returning: Counts = { ...units };
  let battle: unknown = null;
  let seed: number | null = null;
  if (hasShips(escort)) {
    const f = await fightEscort(tx, c, { units, modifiers: mods, versorgungsmangel: origin?.state.versorgungsmangel ?? false }, escort, due);
    held = f.held;
    returning = f.attackerLeft;
    battle = f.report;
    seed = f.seed;
  }
  // Verlust des Konvois: plunderShare der Ladung; davon erbeutet, was in den Laderaum passt, der Rest sinkt.
  const lost = held === true ? {} : splitCargo(c.cargo as ResourceMap, convoysOf(balance)?.plunderShare ?? 0).lost;
  const loot = held === true ? {} : convoyPlunder(c.cargo as ResourceMap, fleetTotals(returning, balance, mods).cargoCapacity, balance);
  const sunk: ResourceMap = {};
  for (const [r, q] of Object.entries(lost)) if (q - (loot[r] ?? 0) > 0) sunk[r] = q - (loot[r] ?? 0);
  if (Object.keys(loot).length > 0) await takeCargo(tx, c, loot, `beute:${pid}`, due);
  if (Object.keys(sunk).length > 0) await takeCargo(tx, c, sunk, "versenkt", due);
  const name = await playerName(tx, pid);
  await addEvent(tx, c, { atMs: due, by: "spieler", name, lost, escortHeld: held });
  const victim = victimOf(c);
  const title = held === true ? "Konvoi abgefangen – Geleitschutz hält" : `Konvoi aufgebracht – ${resText(lost)} verloren, ${resText(loot)} erbeutet`;
  const reportId = await storeNavalReport(tx, {
    kind: "konvoi", title, attackerPlayerId: pid, defenderPlayerId: victim, attackerBaseId: m.baseId, defenderBaseId: c.recipientBaseId,
    winner: held === null ? "attacker" : held ? "defender" : "attacker", seed,
    report: { convoy: { id: c.id, kind: c.kind, by: "spieler", escort, held, lost, loot, cargoLeft: c.cargo }, ...(battle ? { battle, attackerName: name, defenderName: "Geleitschutz", targetName: "Konvoi" } : {}) },
    atMs: due,
  });
  push.push(pushNotice(victim, "attack", `Konvoi von ${name} abgefangen`, held === true ? "Der Geleitschutz hat gehalten." : `Verlust: ${resText(lost)}.`, "berichte"));
  notify.push([[victim], "reports"], [[victim], "base"], [[victim], "market"], [null, "map"]);
  await sendHome(tx, m, plan, activeCounts(returning), loot, reportId, due);
}

/** Geleitmission am Ziel (Lieferung eingelaufen bzw. Zeit um): heim mit den Überlebenden. */
export async function escortArrive(tx: Tx, m: MissionRowLike, plan: Mission, due: number): Promise<void> {
  const [c] = (await tx.select().from(tables.convoy).where(eq(tables.convoy.id, m.targetId!))) as ConvoyRow[];
  const survivors = c && c.escortMissionId === m.id ? activeCounts(c.escort as Counts) : { ...plan.units };
  await tx.update(tables.mission).set({ status: "returning", returning: survivors, cargoHome: {}, returnAt: new Date(due) }).where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "mission_return", due, { missionId: m.id }, m.baseId);
}

/** Transport am Ziel: Verband und Ladung nach Abfangversuchen. null ohne Konvoi. */
export async function transportConvoyArrive(tx: Tx, missionId: number): Promise<{ units: Counts; cargo: ResourceMap } | null> {
  const c = await lockConvoy(tx, { missionId });
  if (!c) return null;
  await tx.update(tables.convoy).set({ status: "arrived" }).where(eq(tables.convoy.id, c.id));
  return { units: activeCounts(c.escort as Counts), cargo: c.cargo as ResourceMap };
}

/** Rückruf eines Transports: Konvoi endet, die (Rest-)Ladung kommt mit heim. */
export async function transportConvoyRecall(tx: Tx, missionId: number): Promise<ResourceMap | null> {
  const c = await lockConvoy(tx, { missionId });
  if (!c || c.status !== "underway") return null;
  await tx.update(tables.convoy).set({ status: "arrived" }).where(eq(tables.convoy.id, c.id));
  return c.cargo as ResourceMap;
}

/** Lieferung eingelaufen: Konvoi abschließen. */
export async function deliveryConvoyArrived(tx: Tx, deliveryId: string): Promise<void> {
  await tx.update(tables.convoy).set({ status: "arrived" }).where(eq(tables.convoy.deliveryId, deliveryId));
}

/** Konvois für Karte und Börse: eigene (Empfänger oder Absender) und die von Kriegsgegnern, mit Position. */
export async function convoysView(db: DbOrTx, playerId: number, nowMs: number) {
  const rows = (await db.select().from(tables.convoy).where(and(eq(tables.convoy.status, "underway"), gt(tables.convoy.arriveAt, new Date(nowMs))))) as ConvoyRow[];
  const out = [];
  const war = new Map<number, boolean>();
  const enemy = async (id: number | null) => {
    if (id === null || id === playerId) return false;
    if (!war.has(id)) war.set(id, await atWar(db, playerId, id, nowMs));
    return war.get(id)!;
  };
  for (const c of rows) {
    const own = c.recipientId === playerId || c.senderId === playerId;
    const hostileConvoy = !own && ((await enemy(c.recipientId)) || (await enemy(c.senderId)));
    if (!own && !hostileConvoy) continue;
    const pos = routePosition(route(c), nowMs);
    const here = hexAtLonLat(pos.lon, pos.lat);
    out.push({
      id: c.id, kind: c.kind, deliveryId: c.deliveryId, missionId: c.missionId, own, enemy: hostileConvoy,
      from: { col: c.fromCol, row: c.fromRow }, to: { col: c.toCol, row: c.toRow }, at: here,
      departAtMs: c.departAt.getTime(), arriveAtMs: c.arriveAt.getTime(),
      cargo: c.cargo as ResourceMap, escort: activeCounts(c.escort as Counts), escorted: hasShips(c.escort as Counts),
      events: (c.events as ConvoyEvent[]) ?? [],
      recipient: own ? null : await playerName(db, c.recipientId),
    });
  }
  return out;
}

/** Konvois zu bestimmten Lieferungen (Börse/Handel). */
export async function convoysForDeliveries(db: DbOrTx, ids: string[]) {
  if (ids.length === 0) return new Map<string, ConvoyRow>();
  const rows = (await db.select().from(tables.convoy).where(inArray(tables.convoy.deliveryId, ids))) as ConvoyRow[];
  return new Map(rows.map((r) => [r.deliveryId!, r]));
}

