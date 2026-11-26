// Nachrichtendienst und Spionage auf dem Server: Vorschau und Auslaufen eines Spionageauftrags (Missionsart
// „spionage“ in der Tabelle mission, Ereignis spy_arrive), Lesemodell für den eigenen Hafen und der Desinformations-
// Eingriff in die Aufklärung. Ankunft, Sabotage-Ende und Dossiers: espionage-run.ts. Regeln: game-core/src/espionage.ts.
import {
  espionageOf,
  falsifyScout,
  intelLevel,
  planSpyMission,
  protectionStatus,
  activeSabotage,
  sabotageCooldownUntil,
  settle,
  spyCap,
  spyChance,
  spyCount,
  spyDefenseValue,
  spySuccessValue,
  spyThreshold,
  takeDisinfo,
  SPY_KINDS,
  type BaseState,
  type Modifiers,
  type ScoutReport,
  type SpyKind,
  type SpyValue,
} from "@tidefront/game-core";
import { hexCenter, hexDistanceKm } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { runCommand, targetAt, type MissionTarget } from "./commands.ts";
import { activeMissionCount, lockOwnBase, ownBase, randomSeed, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { diplomacyBlock } from "./alliance-core.ts";
import { processDueForBase } from "./events.ts";

export interface SpyInput {
  kind: string;
  col?: number;
  row?: number;
  /** Sabotageziel (Gebäude oder "bauschlange"). */
  building?: string;
  /** Mehrere Häfen: Ausgangshafen (P2; fehlt → Heimathafen). */
  baseId?: number;
}

interface Prepared {
  kind: SpyKind;
  target: MissionTarget | null;
  success: SpyValue;
  defense: SpyValue;
  threshold: number;
  chance: number;
  /** Sperrfrist der Sabotage am Ziel (0 ohne). */
  cooldownUntilMs: number;
}

function fail(code: string): never {
  throw new GameError(code);
}

/**
 * Ziel und Probe prüfen (ohne Änderung). Ziele: fremde Spielerhäfen ohne Anfängerschutz (Nachtschild und Schutz nach
 * Niederlage halten Spione nicht auf); Sabotage nicht gegen Verbündete und Paktpartner und höchstens einmal je Ziel
 * in cooldownHours. Kartell: kein Ziel. Codes: no_target, own_base, spy_target, target_beginner, ally, pact, sabotage_cooldown.
 */
async function prepare(db: DbOrTx, playerId: number, own: BaseRow, input: SpyInput, nowMs: number, ownMods: Modifiers): Promise<Prepared> {
  if (!espionageOf(balance)) fail("no_espionage");
  const kind = (SPY_KINDS as readonly string[]).includes(input.kind) ? (input.kind as SpyKind) : null;
  if (!kind) fail("bad_spy_kind");
  let target: MissionTarget | null = null;
  let targetMods: Modifiers | undefined;
  let cooldownUntilMs = 0;
  if (kind !== "kartell") {
    if (input.col === undefined || input.row === undefined) fail("no_target");
    target = await targetAt(db as Tx, input.col, input.row);
    if (!target) fail("no_target");
    if (target.kind !== "base" || target.playerId === null) fail("spy_target");
    if (target.playerId === playerId) fail("own_base");
    if (protectionStatus(target.state!.protection, nowMs, balance).reason === "anfaengerschutz") fail("target_beginner");
    if (kind === "sabotage") {
      const d = await diplomacyBlock(db, playerId, target.playerId, nowMs);
      if (d) fail(d);
      cooldownUntilMs = sabotageCooldownUntil(target.state!, balance);
      if (cooldownUntilMs > nowMs) fail("sabotage_cooldown");
    }
    targetMods = await modsOf(db, { playerId: target.playerId, state: target.state!, id: target.id, isHome: target.isHome }, nowMs);
  }
  const success = spySuccessValue(own.state, kind, balance, ownMods);
  const defense = spyDefenseValue(target?.state ?? null, kind, balance, targetMods);
  const die = espionageOf(balance)!.die;
  // Stufe, Spione und Sabotageziel prüft planSpyMission (die Vorschau zeigt die Werte trotzdem).
  return {
    kind, target, success, defense, cooldownUntilMs,
    threshold: spyThreshold(success.total, defense.total, die),
    chance: spyChance(success.total, defense.total, die),
  };
}

function planFor(own: BaseRow, p: Prepared, input: SpyInput, active: number, nowMs: number, mods: Modifiers, seed: number) {
  return planSpyMission(
    own.state,
    {
      kind: p.kind,
      origin: hexCenter(own.col, own.row),
      target: p.target ? hexCenter(p.target.col, p.target.row) : null,
      activeMissions: active,
      building: input.building,
      seed,
      chance: p.chance,
    },
    nowMs,
    balance,
    mods,
  );
}

/** Vorschau: Reise, Spione, Erfolgswert, Abwehr, Zielzahl und Enttarnungs-Chance – oder der Ablehnungsgrund. */
export async function spyPreview(engine: Engine, playerId: number, input: SpyInput) {
  const nowMs = Date.now();
  let own: BaseRow;
  try {
    own = await ownBase(engine.db, playerId, input.baseId);
  } catch (err) {
    if (err instanceof GameError) return { ok: false as const, code: err.code };
    throw err;
  }
  const mods = await modsOf(engine.db, own, nowMs);
  const die = espionageOf(balance)?.die ?? 20;
  let p: Prepared;
  try {
    p = await prepare(engine.db, playerId, own, input, nowMs, mods);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    return { ok: false as const, code: err.code };
  }
  const values = { success: p.success, defense: p.defense, threshold: p.threshold, die, chance: p.chance, detectChance: 1 - p.chance };
  const r = planFor({ ...own, state: settle(own.state, nowMs, balance, mods) }, p, input, await activeMissionCount(engine.db, own.id), nowMs, mods, 0);
  if (!r.ok) return { ok: false as const, code: r.code, ...values };
  return {
    ok: true as const,
    ...values,
    kind: p.kind,
    spies: r.mission.spy.spies,
    distanceKm: p.target ? hexDistanceKm(own, p.target) : 0,
    travelSeconds: r.mission.travelSeconds,
    arriveAtMs: r.mission.arriveAtMs,
    returnAtMs: r.mission.returnAtMs,
  };
}

/** Spionageauftrag auslaufen lassen. Das Ziel erfährt nichts (kein Radar, keine Vorwarnung). */
export function spyLaunch(engine: Engine, playerId: number, key: string, input: SpyInput) {
  return runCommand<{ ok: true; missionId: number; arriveAtMs: number; chance: number }>(engine, playerId, key, "spy", async (ctx) => {
    const own = await lockOwnBase(ctx.tx, playerId, input.baseId);
    const mods = await modsOf(ctx.tx, own, ctx.nowMs);
    const p = await prepare(ctx.tx, playerId, own, input, ctx.nowMs, mods);
    const r = planFor(own, p, input, await activeMissionCount(ctx.tx, own.id), ctx.nowMs, mods, randomSeed());
    if (!r.ok) return r;
    await saveBase(ctx.tx, own.id, r.base);
    const t = p.target;
    const [m] = await ctx.tx
      .insert(tables.mission)
      .values({
        playerId, baseId: own.id, type: "spionage", targetKind: t ? "base" : "kartell", targetId: t?.id ?? null,
        targetCol: t?.col ?? own.col, targetRow: t?.row ?? own.row, plan: r.mission, status: "outbound",
        arriveAt: new Date(r.mission.arriveAtMs),
      })
      .returning({ id: tables.mission.id });
    await scheduleEvent(ctx.tx, "spy_arrive", r.mission.arriveAtMs, { missionId: m.id }, t?.id ?? null);
    ctx.notify.push([[playerId], "base"], [[playerId], "missions"]);
    return { ok: true as const, missionId: m.id, arriveAtMs: r.mission.arriveAtMs, chance: p.chance };
  });
}

/** Lesemodell für den eigenen Hafen (baseView.intel): Stufe, Spione, Abwehr, Werte je Art, Sabotage, Desinformation. */
export function intelView(state: BaseState, mods: Modifiers, nowMs: number) {
  const e = espionageOf(balance);
  if (!e) return null;
  const sab = activeSabotage(state, nowMs);
  const disinfo = Object.values(state.intel?.disinfo ?? {}).filter((until) => until > nowMs);
  return {
    building: e.building,
    level: intelLevel(state, balance),
    spies: spyCount(state, balance),
    cap: spyCap(state, balance),
    defense: spyDefenseValue(state, "erkunden", balance, mods),
    success: Object.fromEntries(SPY_KINDS.map((k) => [k, spySuccessValue(state, k, balance, mods)])),
    successes: state.intel?.successes ?? 0,
    sabotage: sab ? { target: sab.target, fromMs: sab.fromMs, untilMs: sab.untilMs } : null,
    sabotageCooldownUntilMs: sabotageCooldownUntil(state, balance),
    disinfo: { count: disinfo.length, untilMs: disinfo.length > 0 ? Math.max(...disinfo) : null },
  };
}

/** Eigenes Lagebild der Spionage (Info-Blatt Nachrichtendienst): verarbeitet zuerst fällige Ereignisse. */
export async function intelOwnView(engine: Engine, playerId: number, baseId?: number) {
  const nowMs = Date.now();
  const own = await ownBase(engine.db, playerId, baseId).catch((err: unknown) => {
    if (baseId !== undefined) throw err; // fremder Hafen: no_base
    return null;
  });
  if (!own) return null;
  await processDueForBase(engine, own.id, nowMs);
  const row = await ownBase(engine.db, playerId, own.id);
  return intelView(row.state, await modsOf(engine.db, row, nowMs), nowMs);
}

/**
 * Desinformation in einem Lagebild (Aufklärung oder Erkunden): Hat der Hafen `target` für den Betrachter eine
 * Desinformation hinterlegt, werden die Zahlen verfälscht und die Desinformation verbraucht (gespeichert).
 * `target` muss gesperrt sein. Rückgabe: Lagebild und ob verfälscht wurde.
 */
export async function scoutWithDisinfo(tx: Tx, target: BaseRow, viewerPlayerId: number | null, scout: ScoutReport, atMs: number): Promise<{ scout: ScoutReport; falsified: boolean }> {
  if (viewerPlayerId === null || !target.state.intel?.disinfo) return { scout, falsified: false };
  const t = takeDisinfo(target.state, viewerPlayerId, atMs);
  if (t.changed) {
    await saveBase(tx, target.id, t.base);
    target.state = t.base;
  }
  return t.active ? { scout: falsifyScout(scout, balance), falsified: true } : { scout, falsified: false };
}
