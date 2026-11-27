// See: Minen – Legen, Räumen, Durchfahrt (Hin- und Rückfahrt, Handelskonvois) mit Verlusten und Sichtbarkeit
// (docs/REGELN-SEE.md, Abschnitt Minen). Börsenlieferungen sind keine Konvois und bleiben ausgenommen.
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import {
  capLoot,
  convoyMineLoss,
  distanceKm,
  fleetTotals,
  layStrength,
  mineLayCost,
  mineReturnSeed,
  mineSeed,
  minesOf,
  mineTransit,
  routeCrossesField,
  routeDistanceKm,
  subtractResources,
  hasResources,
  splitCargo,
  sweepPower,
  type Counts,
  type GeoPoint,
  type Mission,
  type ResourceMap,
} from "@tidefront/game-core";
import { hexCenter, hexDistanceKm, terrainAt } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError } from "./context.ts";
import { nOf } from "./names.ts";
import { activeMissionCount, basesOfPlayer, ownBase, saveBase, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import {
  HOUR_MS, hasShips, hostile, insertMission, partyMates, planNaval, playerName, sendHome, storeNavalReport,
  type MissionRowLike, type NavalInput, type Notes,
} from "./naval-common.ts";

export interface FieldRow {
  id: number;
  ownerId: number;
  col: number;
  row: number;
  strength: number;
  maxStrength: number;
  expiresAt: Date;
  createdAt: Date;
}

async function activeFields(db: DbOrTx, nowMs: number): Promise<FieldRow[]> {
  return db
    .select()
    .from(tables.minefield)
    .where(and(gt(tables.minefield.expiresAt, new Date(nowMs)), gt(tables.minefield.strength, 0))) as Promise<FieldRow[]>;
}

async function markKnown(tx: Tx, fieldIds: number[], playerId: number, atMs: number): Promise<void> {
  if (fieldIds.length === 0) return;
  await tx
    .insert(tables.minefieldKnown)
    .values(fieldIds.map((id) => ({ minefieldId: id, playerId, knownAt: new Date(atMs) })))
    .onConflictDoNothing();
}

/** Zielprüfung Minen legen/räumen. Codes: not_sea, too_far, no_minelayer, no_sweeper, too_many_fields. */
async function checkTarget(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number): Promise<void> {
  const m = minesOf(balance);
  if (!m) throw new GameError("bad_type");
  if (terrainAt(input.col, input.row) !== "sea") throw new GameError("not_sea");
  if (input.type === "minen") {
    if (hexDistanceKm(own, input) > m.layRadiusKm) throw new GameError("too_far");
    if (layStrength(input.units, balance) <= 0) throw new GameError("no_minelayer");
    const mine = (await activeFields(db, nowMs)).filter((f) => f.ownerId === playerId);
    if (!mine.some((f) => f.col === input.col && f.row === input.row) && mine.length >= m.maxFieldsPerPlayer) throw new GameError("too_many_fields");
  } else if (sweepPower(input.units, balance) <= 0) {
    throw new GameError("no_sweeper");
  }
}

/** Planung (Start und Vorschau): Legen kostet Rohstoffe je Stärkepunkt. */
async function planMines(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number) {
  await checkTarget(db, playerId, own, input, nowMs);
  const r = planNaval(own, {
    type: input.type === "minen" ? "minen" : "raeumen", baseType: "aufklaerung", units: input.units, col: input.col, row: input.row,
    activeMissions: await activeMissionCount(db, own.id), mods: await modsOf(db, own, nowMs),
  }, nowMs);
  if (!r.ok) return r;
  const strength = input.type === "minen" ? Math.min(minesOf(balance)!.maxStrength, layStrength(input.units, balance)) : 0;
  const cost = input.type === "minen" ? mineLayCost(strength, balance) : {};
  if (!hasResources(r.base.resources, cost)) return { ok: false as const, code: "insufficient_resources" };
  r.base.resources = subtractResources(r.base.resources, cost);
  return { ...r, strength, cost };
}

export async function launchMines(tx: Tx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number, notify: Notes) {
  await purgeExpiredFields(tx, nowMs); // verfallene Felder aufräumen (Abfragen filtern ohnehin nach expiresAt)
  const r = await planMines(tx, playerId, own, input, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const missionId = await insertMission(tx, {
    playerId, baseId: own.id, targetKind: "field", targetId: null, col: input.col, row: input.row,
    plan: { ...r.mission, mineStrength: r.strength, mineCost: r.cost },
  });
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId, arriveAtMs: r.mission.arriveAtMs };
}

export async function previewMines(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number) {
  const r = await planMines(db, playerId, own, input, nowMs);
  if (!r.ok) return r;
  return { ok: true as const, mission: r.mission, extra: { mineStrength: r.strength, mineCost: r.cost } };
}

/** Ankunft: Minenfeld legen (oder verstärken) bzw. fremde Felder auf dem Feld räumen. */
export async function minesArrive(tx: Tx, m: MissionRowLike, plan: Mission & { mineStrength?: number }, due: number, notify: Notes): Promise<void> {
  const mb = minesOf(balance)!;
  const pid = m.playerId!;
  const here = await tx
    .select()
    .from(tables.minefield)
    .where(and(eq(tables.minefield.col, m.targetCol), eq(tables.minefield.row, m.targetRow), gt(tables.minefield.expiresAt, new Date(due))))
    .for("update") as FieldRow[];
  let reportId: number;
  if (m.type === "minen") {
    const add = Math.min(plan.mineStrength ?? Infinity, layStrength(plan.units, balance));
    const own = here.find((f) => f.ownerId === pid);
    const expiresAt = new Date(due + mb.lifetimeHours * HOUR_MS);
    let strength: number;
    if (own) {
      strength = Math.min(mb.maxStrength, own.strength + add);
      await tx.update(tables.minefield).set({ strength, maxStrength: Math.max(own.maxStrength, strength), expiresAt }).where(eq(tables.minefield.id, own.id));
    } else {
      const count = (await activeFields(tx, due)).filter((f) => f.ownerId === pid).length;
      if (count >= mb.maxFieldsPerPlayer) {
        reportId = await storeNavalReport(tx, {
          kind: "minen", title: "Minen nicht gelegt: zu viele Felder", attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId,
          report: { mines: { action: "legen", col: m.targetCol, row: m.targetRow, refused: "too_many_fields" } }, atMs: due,
        });
        await sendHome(tx, m, plan, { ...plan.units }, {}, reportId, due);
        return;
      }
      strength = Math.min(mb.maxStrength, add);
      await tx.insert(tables.minefield).values({
        ownerId: pid, baseId: m.baseId, col: m.targetCol, row: m.targetRow, strength, maxStrength: strength, createdAt: new Date(due), expiresAt,
      });
    }
    reportId = await storeNavalReport(tx, {
      kind: "minen", title: `Minenfeld gelegt (Stärke ${strength})`, attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId,
      report: { mines: { action: "legen", col: m.targetCol, row: m.targetRow, strength, added: add, expiresAtMs: expiresAt.getTime() } }, atMs: due,
    });
  } else {
    let power = sweepPower(plan.units, balance);
    const swept: { id: number; owner: string; before: number; after: number }[] = [];
    for (const f of here.sort((a, b) => a.id - b.id)) {
      if (f.ownerId !== pid && !(await hostile(tx, pid, f.ownerId, due))) continue; // verbündete Felder bleiben
      if (power <= 0) break;
      const cut = Math.min(power, f.strength);
      power -= cut;
      const after = f.strength - cut;
      if (after <= 0) await tx.delete(tables.minefield).where(eq(tables.minefield.id, f.id));
      else await tx.update(tables.minefield).set({ strength: after }).where(eq(tables.minefield.id, f.id));
      swept.push({ id: f.id, owner: await playerName(tx, f.ownerId), before: f.strength, after });
      if (f.ownerId !== pid) await markKnown(tx, [f.id], pid, due);
    }
    reportId = await storeNavalReport(tx, {
      kind: "minen", title: swept.length > 0 ? `Minen geräumt (${swept.reduce((s, x) => s + x.before - x.after, 0)} Stärke)` : "Räumfahrt: keine Minen gefunden",
      attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId,
      report: { mines: { action: "raeumen", col: m.targetCol, row: m.targetRow, swept } }, atMs: due,
    });
  }
  notify.push([null, "map"]);
  await sendHome(tx, m, plan, { ...plan.units }, {}, reportId, due);
}

/** Feindliche Felder, die die Strecke a→b kreuzt (nach Entfernung von a); feindlich gegen alle Beteiligten. */
async function crossedFields(tx: Tx, parties: number[], a: GeoPoint, b: GeoPoint, due: number): Promise<(FieldRow & { at: GeoPoint })[]> {
  const out: (FieldRow & { at: GeoPoint })[] = [];
  for (const f of await activeFields(tx, due)) {
    const at = hexCenter(f.col, f.row);
    if (parties.includes(f.ownerId) || !routeCrossesField(a, b, at, balance)) continue;
    let enemy = true;
    for (const p of parties) if (!(await hostile(tx, p, f.ownerId, due))) enemy = false;
    if (enemy) out.push({ ...f, at });
  }
  return out.sort((x, y) => distanceKm(a, x.at) - distanceKm(a, y.at));
}

/** Stärke eines Felds nach einer Durchfahrt setzen (verbraucht = gelöscht). */
async function consume(tx: Tx, f: FieldRow, consumed: number): Promise<void> {
  const after = f.strength - consumed;
  if (after <= 0) await tx.delete(tables.minefield).where(eq(tables.minefield.id, f.id));
  else if (consumed > 0) await tx.update(tables.minefield).set({ strength: after }).where(eq(tables.minefield.id, f.id));
}

/**
 * Durchfahrt eines Verbands a→b: je gekreuztem feindlichem Feld Verluste per Seed, das Feld verliert Stärke und wird
 * dem Spieler bekannt; ein Bericht für Verband und Feldbesitzer. leg „rueckfahrt“: eigener Würfelstrom.
 */
async function transit(tx: Tx, m: MissionRowLike, a: GeoPoint, b: GeoPoint, units: Counts, leg: "hinfahrt" | "rueckfahrt", due: number, notify: Notes): Promise<Counts> {
  const pid = m.playerId!;
  const crossed = await crossedFields(tx, [pid], a, b, due);
  if (crossed.length === 0) return units;
  let left: Counts = { ...units };
  const hits: { fieldId: number; col: number; row: number; owner: string; strength: number; losses: Counts }[] = [];
  const owners: number[] = [];
  for (const f of crossed) {
    const t = mineTransit(left, f.strength, balance, leg === "rueckfahrt" ? mineReturnSeed(m.id, f.id) : mineSeed(m.id, f.id));
    left = t.survivors;
    await consume(tx, f, t.consumed);
    await markKnown(tx, [f.id], pid, due);
    hits.push({ fieldId: f.id, col: f.col, row: f.row, owner: await playerName(tx, f.ownerId), strength: f.strength, losses: t.losses });
    owners.push(f.ownerId);
  }
  const lost = hits.reduce((s, h) => s + Object.values(h.losses).reduce((x, y) => x + y, 0), 0);
  const back = leg === "rueckfahrt" ? " auf der Rückfahrt" : "";
  // Ein Bericht je Feldbesitzer-Gruppe: der Verband sieht alles, die Besitzer sehen „ihren“ Treffer.
  await storeNavalReport(tx, {
    kind: "minen", title: lost > 0 ? `Minentreffer${back}: ${nOf(lost, "Einheit", "Einheiten")} verloren` : `Minenfeld${back} durchfahren – ohne Verluste`,
    attackerPlayerId: pid, defenderPlayerId: owners[0], attackerBaseId: m.baseId,
    report: { mines: { action: "durchfahrt", leg, hits, before: units, after: left, missionType: m.type } }, atMs: due,
  });
  notify.push([[pid], "reports"], [[owners[0]], "reports"], [null, "map"]);
  return left;
}

/**
 * Hinfahrt durch fremde Minenfelder: je gekreuztem feindlichem Feld (nach Entfernung vom Start) Verluste per Seed,
 * das Feld verliert Stärke und wird dem Spieler bekannt. Aufklärung deckt zusätzlich Felder nahe Ziel und Route auf.
 */
export async function mineTransitFor(tx: Tx, m: MissionRowLike, plan: Mission, due: number, notify: Notes): Promise<Counts> {
  const mb = minesOf(balance);
  const pid = m.playerId;
  if (!mb || pid === null) return plan.units;
  if (m.type === "aufklaerung") {
    const seen = (await activeFields(tx, due)).filter((f) => f.ownerId !== pid && routeDistanceKm(plan.origin, plan.target, hexCenter(f.col, f.row)) <= mb.scoutRevealKm);
    await markKnown(tx, seen.map((f) => f.id), pid, due);
  }
  if (!hasShips(plan.units)) return plan.units;
  return transit(tx, m, plan.origin, plan.target, plan.units, "hinfahrt", due, notify);
}

/**
 * Rückfahrt durch fremde Minenfelder (Hook in mission_return): Strecke Ziel → Hafen, nach Rückruf auf der Hinfahrt
 * vom Wendepunkt. Ausgenommen: Geleit des Annehmenden im Spielerhandel (seine Rückfahrt ist der Konvoiweg, den
 * convoyMineTransit schon rechnet). Ladung, die der verbliebene Laderaum nicht mehr fasst, geht mit unter.
 */
export async function mineReturnFor(
  tx: Tx, m: MissionRowLike, plan: Mission & { sellerEscort?: boolean }, returning: Counts, cargo: ResourceMap, due: number, notify: Notes,
): Promise<{ units: Counts; cargo: ResourceMap }> {
  if (!minesOf(balance) || m.playerId === null || !hasShips(returning) || (m.type === "geleit" && !plan.sellerEscort)) return { units: returning, cargo };
  let from = plan.target;
  if (plan.recalledAtMs !== undefined) {
    const span = plan.arriveAtMs - plan.departAtMs;
    const t = span > 0 ? Math.max(0, Math.min(1, (plan.recalledAtMs - plan.departAtMs) / span)) : 0;
    from = { lat: plan.origin.lat + (plan.target.lat - plan.origin.lat) * t, lon: plan.origin.lon + (plan.target.lon - plan.origin.lon) * t };
  }
  const units = await transit(tx, m, from, plan.origin, returning, "rueckfahrt", due, notify);
  const lostShips = Object.entries(returning).some(([id, n]) => (units[id] ?? 0) < n);
  return { units, cargo: lostShips ? capLoot(cargo, fleetTotals(units, balance).cargoCapacity) : cargo };
}

/**
 * Handelskonvoi durch fremde Minenfelder (beim Einlaufen): feindlich gegen Absender und Empfänger. Die Ladung verliert
 * je Feld convoyMineLoss, Geleitschiffe sinken wie ein Verband (Räumer im Geleit schützen auch die Ladung).
 */
export async function convoyMineTransit(
  tx: Tx, c: { id: number; senderId: number | null; recipientId: number; fromCol: number; fromRow: number; toCol: number; toRow: number; cargo: unknown },
  escort: Counts, due: number,
): Promise<{ lost: ResourceMap; escort: Counts; hits: { fieldId: number; owner: string; strength: number; share: number; losses: Counts }[]; owners: number[] }> {
  const none = { lost: {}, escort, hits: [], owners: [] };
  if (!minesOf(balance)) return none;
  const parties = [c.recipientId, ...(c.senderId !== null && c.senderId !== c.recipientId ? [c.senderId] : [])];
  const crossed = await crossedFields(tx, parties, hexCenter(c.fromCol, c.fromRow), hexCenter(c.toCol, c.toRow), due);
  if (crossed.length === 0) return none;
  let cargo = { ...(c.cargo as ResourceMap) };
  let left: Counts = { ...escort };
  const lost: ResourceMap = {};
  const hits = [];
  for (const f of crossed) {
    const loss = convoyMineLoss(f.strength, left, balance);
    const split = splitCargo(cargo, loss.share);
    cargo = split.kept;
    for (const [r, q] of Object.entries(split.lost)) lost[r] = (lost[r] ?? 0) + q;
    const t = hasShips(left) ? mineTransit(left, f.strength, balance, mineSeed(c.id, f.id) ^ 0x434f4e56) : null;
    if (t) left = t.survivors;
    await consume(tx, f, Math.min(f.strength, (Object.keys(split.lost).length > 0 ? loss.consumed : 0) + (t?.consumed ?? 0)));
    for (const p of parties) await markKnown(tx, [f.id], p, due);
    hits.push({ fieldId: f.id, owner: await playerName(tx, f.ownerId), strength: f.strength, share: Math.round(loss.share * 1000) / 1000, losses: t?.losses ?? {} });
  }
  return { lost, escort: left, hits, owners: crossed.map((f) => f.ownerId) };
}

/** Felder, die ein Spieler sieht: eigene, der Allianz, bekannte und im Radarbereich. */
export async function visibleFields(db: DbOrTx, playerId: number, nowMs: number) {
  const mb = minesOf(balance);
  if (!mb) return [];
  const all = await activeFields(db, nowMs);
  if (all.length === 0) return [];
  const mates = new Set(await partyMates(db, playerId));
  const known = new Set((await db
    .select({ id: tables.minefieldKnown.minefieldId })
    .from(tables.minefieldKnown)
    .where(and(eq(tables.minefieldKnown.playerId, playerId), inArray(tables.minefieldKnown.minefieldId, all.map((f) => f.id))))).map((r) => r.id));
  // Mehrere Häfen: Radar-Sicht ist die Vereinigung der Radarkreise aller eigenen Häfen.
  const radars = (await basesOfPlayer(db, playerId))
    .map((b) => ({ col: b.col, row: b.row, km: (b.state.buildings.radarstation ?? 0) * mb.radarKmPerLevel }))
    .filter((r) => r.km > 0);
  const owners = new Map<number, string>();
  const out = [];
  for (const f of all) {
    const allied = mates.has(f.ownerId);
    const inRadar = radars.some((r) => hexDistanceKm(r, f) <= r.km);
    if (!allied && !known.has(f.id) && !inRadar) continue;
    if (!owners.has(f.ownerId)) owners.set(f.ownerId, await playerName(db, f.ownerId));
    out.push({
      id: f.id, col: f.col, row: f.row, strength: f.strength, maxStrength: f.maxStrength, expiresAtMs: f.expiresAt.getTime(),
      own: f.ownerId === playerId, allied: allied && f.ownerId !== playerId, owner: owners.get(f.ownerId)!,
      via: allied ? "eigen" : known.has(f.id) ? "bekannt" : "radar",
    });
  }
  return out;
}

/** Bekannte feindliche Felder auf der Route vom (aktiven) eigenen Hafen zum Feld col/row (Warnung in der Planung). */
export async function routeMines(db: DbOrTx, playerId: number, col: number, row: number, nowMs: number, baseId?: number) {
  const own = await ownBase(db, playerId, baseId).catch((err: unknown) => {
    if (baseId !== undefined) throw err;
    return null;
  });
  if (!own) return [];
  const a = hexCenter(own.col, own.row), b = hexCenter(col, row);
  const out = [];
  for (const f of await visibleFields(db, playerId, nowMs)) {
    if (f.own || f.allied) continue;
    if (routeCrossesField(a, b, hexCenter(f.col, f.row), balance)) out.push(f);
  }
  return out;
}

export async function purgeExpiredFields(tx: Tx, nowMs: number): Promise<void> {
  await tx.delete(tables.minefield).where(lte(tables.minefield.expiresAt, new Date(nowMs)));
}
