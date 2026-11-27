// Auftragsbuch: elf Grundaufträge mit Belohnung (Quelle der Wahrheit für Erfüllung und Abholstatus) und eine
// Abschlussbelohnung mit Abzeichen „Hafenmeister“ und einmalig −1 Stunde Bauzeit. Je Spieler und Saison wird
// jeder Auftrag genau einmal abgeholt (Tabelle guide_claim mit season_id). Abholen über runCommand.
// Werte: balance.json, Schlüssel guide (REGELN.md, Abschnitt Auftragsbuch).
import { and, eq, isNull, sql } from "drizzle-orm";
import { settle, storageCapacity, type BaseState, type Modifiers, type ResourceMap } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { baseOfPlayer, lockBase, saveBase, scheduleEvent } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { runningSeason } from "./season.ts";
import { nearestOpenLevel1, START_NEST_KM } from "./start-nest.ts";

const gc = tables.guideClaim;
export const GUIDE_FINAL = "final";

export interface GuideBalance {
  steps: Record<string, ResourceMap>;
  final: { reward: ResourceMap; buildBoostSeconds: number };
}

export function guideBalance(): GuideBalance {
  const g = (balance as unknown as { guide?: GuideBalance }).guide;
  return g ?? { steps: {}, final: { reward: {}, buildBoostSeconds: 0 } };
}

const lvl = (s: BaseState, id: string) => s.buildings[id] ?? 0;
const units = (s: BaseState, id: string) => (s.units[id] ?? 0) + (s.unitsAway[id] ?? 0);

/**
 * Ausbildungsziele der Aufträge „wache“ und „flotte“. 30 Schützen: Mit 20 siegt ein Überfall auf Nest Stufe 1
 * (4 Schnellboote, 18 Miliz) im Probekampf nur zu ~1 %, mit 30 sicher (test/einstieg.test.ts). Texte in Guide.tsx.
 */
export const GUIDE_GOALS = { schuetzen: 30, korvette: 2, landungsschiff: 1 } as const;

/** Die elf Aufträge in Reihenfolge; Texte stehen in der Oberfläche (Guide.tsx). */
export const GUIDE_STEPS: { id: string; done: (s: BaseState, wonNest: boolean) => boolean }[] = [
  { id: "strom", done: (s) => lvl(s, "kraftwerk") >= 1 },
  { id: "stahl", done: (s) => lvl(s, "stahlwerk") >= 1 },
  { id: "basis", done: (s) => lvl(s, "raffinerie") >= 1 && lvl(s, "versorgungshof") >= 1 },
  { id: "kz", done: (s) => lvl(s, "kommandozentrale") >= 1 },
  { id: "kaserne", done: (s) => lvl(s, "kaserne") >= 1 },
  { id: "wache", done: (s) => units(s, "schuetzen") >= GUIDE_GOALS.schuetzen },
  { id: "werft", done: (s) => lvl(s, "werft") >= 1 },
  { id: "flotte", done: (s) => units(s, "korvette") >= GUIDE_GOALS.korvette && units(s, "landungsschiff") >= GUIDE_GOALS.landungsschiff },
  { id: "nest", done: (_s, won) => won },
  { id: "hafen", done: (s) => lvl(s, "hafenkommandantur") >= 3 },
  { id: "schutz", done: (s) => lvl(s, "radarstation") >= 1 && lvl(s, "tiefbunker") >= 1 },
];

function fail(code: string): never {
  throw new GameError(code);
}

/** Eigener gewonnener Überfall auf ein Piratennest (Kampfberichte gelten je Saison). */
async function wonNestRaid(db: DbOrTx, playerId: number): Promise<boolean> {
  const r = tables.battleReport;
  const [row] = await db
    .select({ id: r.id })
    .from(r)
    .where(and(eq(r.kind, "ueberfall"), eq(r.attackerPlayerId, playerId), eq(r.winner, "attacker"), sql`${r.nestId} is not null`))
    .limit(1);
  return !!row;
}

async function claimsOf(db: DbOrTx, playerId: number, seasonId: number) {
  return db.select().from(gc).where(and(eq(gc.playerId, playerId), eq(gc.seasonId, seasonId)));
}

/** Auftragsbuch des Spielers: je Auftrag erfüllt, abgeholt, Belohnung; Abschluss; Zahl abholbarer Belohnungen. */
export async function guideView(engine: Engine, playerId: number) {
  const g = guideBalance();
  const s = await runningSeason(engine.db);
  const own = await baseOfPlayer(engine.db, playerId); // Mehrere Häfen: bewusst Heimathafen (Leitfaden folgt dem Heimathafen)
  const claims = s ? await claimsOf(engine.db, playerId, s.id) : [];
  const claimed = new Map(claims.map((c) => [c.step, c]));
  const won = own ? await wonNestRaid(engine.db, playerId) : false;
  const steps = GUIDE_STEPS.map((st) => {
    const isClaimed = claimed.has(st.id);
    const done = isClaimed || (!!own && st.done(own.state, won));
    return { id: st.id, done, claimed: isClaimed, claimable: !!own && !!s && done && !isClaimed, reward: g.steps[st.id] ?? {} };
  });
  const fin = claimed.get(GUIDE_FINAL);
  const allClaimed = steps.every((x) => x.claimed);
  const final = {
    reward: g.final.reward,
    boostSeconds: g.final.buildBoostSeconds,
    claimable: !!own && !!s && allClaimed && !fin,
    claimed: !!fin,
    boostPending: !!fin && fin.boostUsedAt === null,
  };
  // Ziel des Nest-Auftrags: das nächste offene Nest der Stufe 1 (bevorzugt das zugesicherte in START_NEST_KM). Die
  // Stufe ist hier offen – auch unter Kartennebel –, damit „Lohnende Ziele“ den Überfall vorrechnen kann.
  const nestOpen = !!own && !steps.find((x) => x.id === "nest")?.done;
  const nestTarget = nestOpen && own
    ? (await nearestOpenLevel1(engine.db, own, Date.now())) ?? (await nearestOpenLevel1(engine.db, own, Date.now(), Infinity))
    : null;
  return {
    hasBase: !!own,
    steps,
    final,
    nestTarget: nestTarget ? { ...nestTarget, guaranteed: nestTarget.distanceKm <= START_NEST_KM } : null,
    doneCount: steps.filter((x) => x.done).length,
    claimable: steps.filter((x) => x.claimable).length + (final.claimable ? 1 : 0),
  };
}

/**
 * Belohnung ins Lager: füllt höchstens bis zur Lagerkapazität (Bestände darüber bleiben, sinken aber nicht). Der Rest
 * verfällt und wird als `lost` gemeldet – die Oberfläche warnt vorher und rät zum Lagerkomplex; abholen kann man
 * jeden Auftrag die ganze Saison, also auch erst nach dem Ausbau. Rein, ohne Datenbank.
 */
export function deliverToStorage(state: BaseState, reward: ResourceMap, nowMs: number, mods?: Modifiers): { state: BaseState; lost: ResourceMap } {
  const next = settle(state, nowMs, balance, mods);
  const cap = storageCapacity(next, balance, mods);
  const resources = { ...next.resources };
  const lost: ResourceMap = {};
  for (const [r, amount] of Object.entries(reward)) {
    if (!(amount > 0)) continue;
    const cur = resources[r] ?? 0;
    const add = Math.min(amount, Math.max(0, cap - cur));
    resources[r] = cur + add;
    if (amount - add > 0) lost[r] = amount - add;
  }
  return { state: { ...next, resources }, lost };
}

/** Spieler mit Abzeichen „Hafenmeister“ in der laufenden Saison. */
export async function hafenmeisterIds(db: DbOrTx, seasonId: number | null): Promise<Set<number>> {
  if (seasonId === null) return new Set();
  const rows = await db.select({ playerId: gc.playerId }).from(gc).where(and(eq(gc.seasonId, seasonId), eq(gc.step, GUIDE_FINAL)));
  return new Set(rows.map((r) => r.playerId));
}

/** Belohnung eines erfüllten Auftrags abholen (genau einmal je Saison). Codes: no_base, no_season, unknown_step, not_done, already_claimed. */
export function claimGuideStep(engine: Engine, playerId: number, key: string, stepId: string) {
  return runCommand<{ ok: true; reward: ResourceMap; lost: ResourceMap }>(engine, playerId, key, "guideClaim", (ctx) => claimGuideStepIn(ctx, playerId, stepId));
}

/** Kern von claimGuideStep in einer bestehenden Transaktion (auch für „Alle abholen“, rewards-claim.ts). */
export async function claimGuideStepIn(ctx: Ctx, playerId: number, stepId: string) {
  const step = GUIDE_STEPS.find((s) => s.id === stepId);
  if (!step) fail("unknown_step");
  const { b, seasonId } = await lockedOwn(ctx.tx, playerId);
  const [had] = await ctx.tx.select({ step: gc.step }).from(gc).where(and(eq(gc.playerId, playerId), eq(gc.seasonId, seasonId), eq(gc.step, stepId)));
  if (had) fail("already_claimed");
  if (!step.done(b.state, step.id === "nest" ? await wonNestRaid(ctx.tx, playerId) : false)) fail("not_done");
  await insertClaim(ctx.tx, playerId, seasonId, stepId, ctx.nowMs, null);
  const reward = guideBalance().steps[stepId] ?? {};
  const d = deliverToStorage(b.state, reward, ctx.nowMs, await modsOf(ctx.tx, b, ctx.nowMs));
  await saveBase(ctx.tx, b.id, d.state);
  ctx.notify.push([[playerId], "base"]);
  return { ok: true as const, reward, lost: d.lost };
}

/**
 * Abschlussbelohnung nach allen elf Aufträgen: Paket, Abzeichen und −1 Stunde Bauzeit für den laufenden Ausbau
 * (läuft keiner, für den nächsten). Codes: no_base, no_season, not_done, already_claimed.
 */
export function claimGuideFinal(engine: Engine, playerId: number, key: string) {
  return runCommand<{ ok: true; reward: ResourceMap; boostApplied: boolean; lost: ResourceMap }>(engine, playerId, key, "guideClaimFinal", (ctx) => claimGuideFinalIn(ctx, playerId));
}

/** Kern von claimGuideFinal in einer bestehenden Transaktion (auch für „Alle abholen“, rewards-claim.ts). */
export async function claimGuideFinalIn(ctx: Ctx, playerId: number) {
  const { b, seasonId } = await lockedOwn(ctx.tx, playerId);
  const claims = await claimsOf(ctx.tx, playerId, seasonId);
  if (claims.some((c) => c.step === GUIDE_FINAL)) fail("already_claimed");
  const have = new Set(claims.map((c) => c.step));
  if (!GUIDE_STEPS.every((s) => have.has(s.id))) fail("not_done");
  const g = guideBalance();
  const d = deliverToStorage(b.state, g.final.reward, ctx.nowMs, await modsOf(ctx.tx, b, ctx.nowMs));
  let state = d.state;
  const boostApplied = state.buildQueue.length > 0;
  if (boostApplied) state = await boostQueue(ctx.tx, b.id, state, g.final.buildBoostSeconds * 1000, ctx.nowMs);
  await insertClaim(ctx.tx, playerId, seasonId, GUIDE_FINAL, ctx.nowMs, boostApplied ? ctx.nowMs : null);
  await saveBase(ctx.tx, b.id, state);
  ctx.notify.push([[playerId], "base"], [null, "season"]);
  return { ok: true as const, reward: g.final.reward, boostApplied, lost: d.lost };
}

/**
 * Für den Befehl upgrade: steht die Bauzeitverkürzung noch aus und ist der neue Auftrag der laufende, wird er
 * verkürzt und die Verkürzung als verbraucht vermerkt. Gibt den (ggf. geänderten) Zustand zurück.
 */
export async function applyPendingBoost(tx: Tx, playerId: number, state: BaseState, nowMs: number): Promise<BaseState> {
  if (state.buildQueue.length !== 1) return state;
  const s = await runningSeason(tx);
  if (!s) return state;
  const used = await tx
    .update(gc)
    .set({ boostUsedAt: new Date(nowMs) })
    .where(and(eq(gc.playerId, playerId), eq(gc.seasonId, s.id), eq(gc.step, GUIDE_FINAL), isNull(gc.boostUsedAt)))
    .returning({ step: gc.step });
  if (used.length === 0) return state;
  return shortenQueue(state, guideBalance().final.buildBoostSeconds * 1000, nowMs);
}

/**
 * Verkürzt den laufenden Ausbau um ms (frühestens fertig jetzt); die Aufträge dahinter rücken um dieselbe
 * Spanne vor. Rein, ohne Datenbank.
 */
export function shortenQueue(state: BaseState, ms: number, nowMs: number): BaseState {
  const first = state.buildQueue[0];
  if (!first || ms <= 0) return state;
  const delta = Math.max(0, Math.min(ms, first.finishesAt - nowMs));
  if (delta === 0) return state;
  return {
    ...state,
    buildQueue: state.buildQueue.map((o, i) =>
      i === 0 ? { ...o, finishesAt: o.finishesAt - delta } : { ...o, startedAt: o.startedAt - delta, finishesAt: o.finishesAt - delta }),
  };
}

/** Verkürzt die Bauschlange und plant build_complete für die neuen Zeitpunkte (die alten laufen ins Leere). */
async function boostQueue(tx: Tx, baseId: number, state: BaseState, ms: number, nowMs: number): Promise<BaseState> {
  const next = shortenQueue(state, ms, nowMs);
  for (const [i, o] of next.buildQueue.entries()) {
    if (o.finishesAt !== state.buildQueue[i].finishesAt) await scheduleEvent(tx, "build_complete", o.finishesAt, {}, baseId);
  }
  return next;
}

async function lockedOwn(tx: Tx, playerId: number) {
  const own = await baseOfPlayer(tx, playerId); // Mehrere Häfen: bewusst Heimathafen (Belohnung dorthin)
  if (!own) fail("no_base");
  // Sperre auf dem Stützpunkt: gleichzeitige Abholungen desselben Spielers laufen nacheinander.
  const b = await lockBase(tx, own.id);
  if (!b) fail("no_base");
  const s = await runningSeason(tx);
  if (!s) fail("no_season");
  return { b, seasonId: s.id };
}

async function insertClaim(tx: Tx, playerId: number, seasonId: number, step: string, nowMs: number, boostUsedMs: number | null) {
  const ins = await tx
    .insert(gc)
    .values({ playerId, seasonId, step, claimedAt: new Date(nowMs), boostUsedAt: boostUsedMs === null ? null : new Date(boostUsedMs) })
    .onConflictDoNothing()
    .returning({ step: gc.step });
  if (ins.length === 0) fail("already_claimed");
}

