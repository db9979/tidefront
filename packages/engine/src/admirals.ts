// Admirale im Server: Ernennen, Spezialisierung, Hafenkommandant, Lösegeld, Entlassen und Ansicht.
// Regeln rein im Kern (game-core/src/admirals.ts); Status und Auslaufen in admirals-core.ts, Kampf in admirals-battle.ts.
import { eq } from "drizzle-orm";
import {
  ADMIRAL_NAMES,
  admiralModLines,
  admiralRank,
  admiralSlots,
  buildingLevel,
  nextAdmiralRank,
  pickAdmiralName,
  settle,
  type AdmiralModLine,
} from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { baseOfPlayer, lockBase, randomSeed, saveBase } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { activeMissions, admiralStatus, type AdmiralRow, type AdmiralStatus } from "./admirals-core.ts";

function fail(code: string): never {
  throw new GameError(code);
}

const cents = (n: number) => Math.round(n * 100) / 100;
const specsOf = (a: AdmiralRow) => [a.spec1, a.spec2];

// ---------------------------------------------------------------- Befehle

async function lockOwnAdmiral(ctx: Ctx, admiralId: number): Promise<AdmiralRow> {
  const [a] = await ctx.tx.select().from(tables.admiral).where(eq(tables.admiral.id, admiralId)).for("update");
  if (!a || a.playerId !== ctx.playerId) fail("admiral_unknown");
  return a;
}

/** Kredite abbuchen (mit Journal wie im Handel). Code admiral_funds. */
async function payCredits(ctx: Ctx, amount: number, tradeId: string): Promise<void> {
  if (amount <= 0) return;
  const [p] = await ctx.tx.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, ctx.playerId)).for("update");
  const trader = p.trader as { credits: number };
  if (trader.credits + 1e-9 < amount) fail("admiral_funds");
  await ctx.tx.update(tables.player).set({ trader: { ...trader, credits: cents(trader.credits - amount) } }).where(eq(tables.player.id, ctx.playerId));
  await ctx.tx.insert(tables.tradeLedger).values([
    { tradeId, tMs: ctx.nowMs, account: `player:${ctx.playerId}`, asset: "credits", amount: cents(-amount).toFixed(2) },
    { tradeId, tMs: ctx.nowMs, account: "admiralitaet", asset: "credits", amount: cents(amount).toFixed(2) },
  ]);
}

/**
 * Admiral ernennen. name: aus der Namensliste oder null (zufällig). Kosten: Kredite und Elektronik.
 * Codes: no_base, admiral_off, admiral_slots, admiral_name, admiral_spec, admiral_funds, insufficient_resources.
 */
export function appointAdmiral(engine: Engine, playerId: number, key: string, input: { name: string | null; spec: string }) {
  return runCommand<{ ok: true; admiralId: number; name: string }>(engine, playerId, key, "admiralAppoint", async (ctx) => {
    const cfg = balance.admirals ?? fail("admiral_off");
    if (!Object.hasOwn(cfg.specs, input.spec)) fail("admiral_spec");
    const own = (await baseOfPlayer(ctx.tx, playerId)) ?? fail("no_base");
    const b = (await lockBase(ctx.tx, own.id)) ?? fail("no_base");
    const rows = await ctx.tx.select().from(tables.admiral).where(eq(tables.admiral.playerId, playerId));
    if (rows.length >= admiralSlots(buildingLevel(b.state, "hafenkommandantur"), balance)) fail("admiral_slots");
    const used = rows.map((r) => r.name);
    const name = input.name ?? pickAdmiralName(randomSeed(), used);
    if (!ADMIRAL_NAMES.includes(name) || used.includes(name)) fail("admiral_name");
    const state = settle(b.state, ctx.nowMs, balance, await modsOf(ctx.tx, b, ctx.nowMs));
    if ((state.resources.elektronik ?? 0) + 1e-9 < cfg.cost.elektronik) fail("insufficient_resources");
    state.resources = { ...state.resources, elektronik: (state.resources.elektronik ?? 0) - cfg.cost.elektronik };
    await saveBase(ctx.tx, b.id, state);
    const [a] = await ctx.tx
      .insert(tables.admiral)
      .values({ playerId, baseId: b.id, name, spec1: input.spec, stationed: rows.every((r) => !r.stationed) })
      .returning({ id: tables.admiral.id });
    await payCredits(ctx, cfg.cost.credits, `admiral-${a.id}:appoint`);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, admiralId: a.id, name };
  });
}

/** Zweite Spezialisierung wählen (ab Rang secondSpecFromRank). Codes: admiral_unknown, admiral_rank, admiral_spec. */
export function chooseAdmiralSpec(engine: Engine, playerId: number, key: string, input: { admiralId: number; spec: string }) {
  return runCommand<{ ok: true }>(engine, playerId, key, "admiralSpec", async (ctx) => {
    const cfg = balance.admirals ?? fail("admiral_off");
    const a = await lockOwnAdmiral(ctx, input.admiralId);
    if (a.spec2) fail("admiral_spec");
    if (admiralRank(a.xp, balance).index < cfg.secondSpecFromRank) fail("admiral_rank");
    if (!Object.hasOwn(cfg.specs, input.spec) || input.spec === a.spec1) fail("admiral_spec");
    await ctx.tx.update(tables.admiral).set({ spec2: input.spec }).where(eq(tables.admiral.id, a.id));
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const };
  });
}

/** Hafenkommandant festlegen (admiralId) oder abberufen (null). Höchstens einer je Spieler. */
export function stationAdmiral(engine: Engine, playerId: number, key: string, input: { admiralId: number | null }) {
  return runCommand<{ ok: true }>(engine, playerId, key, "admiralStation", async (ctx) => {
    if (input.admiralId !== null) await lockOwnAdmiral(ctx, input.admiralId);
    await ctx.tx.update(tables.admiral).set({ stationed: false }).where(eq(tables.admiral.playerId, playerId));
    if (input.admiralId !== null) await ctx.tx.update(tables.admiral).set({ stationed: true }).where(eq(tables.admiral.id, input.admiralId));
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const };
  });
}

/** Lösegeld zahlen: gefangener Admiral kehrt sofort zurück. Codes: admiral_unknown, admiral_not_captive, admiral_funds. */
export function ransomAdmiral(engine: Engine, playerId: number, key: string, input: { admiralId: number }) {
  return runCommand<{ ok: true }>(engine, playerId, key, "admiralRansom", async (ctx) => {
    const cfg = balance.admirals ?? fail("admiral_off");
    const a = await lockOwnAdmiral(ctx, input.admiralId);
    if (!a.captiveUntil || a.captiveUntil.getTime() <= ctx.nowMs) fail("admiral_not_captive");
    await payCredits(ctx, cfg.risk.ransomCredits, `admiral-${a.id}:ransom-${ctx.nowMs}`);
    await ctx.tx.update(tables.admiral).set({ captiveUntil: null }).where(eq(tables.admiral.id, a.id));
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const };
  });
}

/** Admiral entlassen (gibt den Platz frei, keine Erstattung). Nicht unterwegs. Codes: admiral_unknown, admiral_busy. */
export function dismissAdmiral(engine: Engine, playerId: number, key: string, input: { admiralId: number }) {
  return runCommand<{ ok: true }>(engine, playerId, key, "admiralDismiss", async (ctx) => {
    const a = await lockOwnAdmiral(ctx, input.admiralId);
    if (admiralStatus(a, await activeMissions(ctx.tx, [a]), ctx.nowMs).status === "unterwegs") fail("admiral_busy");
    await ctx.tx.delete(tables.admiral).where(eq(tables.admiral.id, a.id));
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- Ansicht

export interface AdmiralInfo {
  id: number;
  name: string;
  xp: number;
  rank: string;
  rankName: string;
  rankIndex: number;
  next: { name: string; minXp: number } | null;
  specs: string[];
  /** Zweite Spezialisierung jetzt wählbar. */
  canChooseSecond: boolean;
  stationed: boolean;
  status: AdmiralStatus;
  until: number | null;
  battles: number;
  wins: number;
  mission: AdmiralModLine[];
  defense: AdmiralModLine[];
  harbor: AdmiralModLine[];
}

/** Karte „Admirale“: Plätze, Kosten, Regeln und eigene Admirale. */
export async function admiralView(engine: Engine, playerId: number) {
  const cfg = balance.admirals;
  const own = await baseOfPlayer(engine.db, playerId);
  if (!cfg || !own) return null;
  const nowMs = Date.now();
  const rows = await engine.db.select().from(tables.admiral).where(eq(tables.admiral.playerId, playerId)).orderBy(tables.admiral.id);
  const active = await activeMissions(engine.db, rows);
  const list: AdmiralInfo[] = rows.map((a) => {
    const r = admiralRank(a.xp, balance);
    const next = nextAdmiralRank(a.xp, balance);
    const specs = specsOf(a);
    return {
      id: a.id, name: a.name, xp: a.xp, rank: r.def.id, rankName: r.def.name, rankIndex: r.index,
      next: next ? { name: next.name, minXp: next.minXp } : null,
      specs: [a.spec1, ...(a.spec2 ? [a.spec2] : [])],
      canChooseSecond: !a.spec2 && r.index >= cfg.secondSpecFromRank,
      stationed: a.stationed,
      ...admiralStatus(a, active, nowMs),
      battles: a.battles, wins: a.wins,
      mission: admiralModLines(specs, a.xp, "mission", balance),
      defense: admiralModLines(specs, a.xp, "defense", balance),
      harbor: admiralModLines(specs, a.xp, "harbor", balance),
    };
  });
  const used = rows.map((r) => r.name);
  return {
    slots: admiralSlots(buildingLevel(own.state, "hafenkommandantur"), balance),
    slotsRule: cfg.slots,
    cost: cfg.cost,
    ranks: cfg.ranks,
    secondSpecFromRank: cfg.secondSpecFromRank,
    specs: Object.entries(cfg.specs).map(([id, s]) => ({ id, name: s.name, text: s.text, mission: s.mission ?? {}, defense: s.defense ?? {}, harbor: s.harbor ?? {} })),
    risk: cfg.risk,
    names: ADMIRAL_NAMES.filter((n) => !used.includes(n)),
    list,
  };
}

/** Gültige Spezialisierungen (für die Eingabeprüfung im Router). */
export function admiralSpecIds(): string[] {
  return Object.keys(balance.admirals?.specs ?? {});
}

