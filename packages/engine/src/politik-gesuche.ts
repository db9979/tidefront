// Weltpolitik: Gesuche der KI-Spieler (docs/REGELN-WELTPOLITIK.md, Abschnitt 4). Der Wartungslauf (runGesuche) bietet
// jedem aktiven Menschen höchstens ein Gesuch je Spieltag an (reihum: zuerst, wer am längsten keines hatte), zieht den
// Lohn als Treuhand aus dem Lager des KI-Spielers ab, lässt unangenommene nach 24 h verfallen und rechnet angenommene
// nach ihrem Liefervertrag ab (erfüllt: Lohn in den Heimathafen, Tagesbefehl erledigt). Annahme = KI-Liefervertrag
// (contracts-sign.ts) im selben Befehl, belegt einen Tagesbefehl-Platz.
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  gesuchBudget, gesuchQty, gesuchReward, politikLimitMs, politikOf, politikScale, productionRates, settle, storageCapacity,
  valueOf, type ResourceMap,
} from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { homeBaseOf, lockBase, lockBases, saveBase } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { deliverToStorage } from "./guide.ts";
import { dayKey } from "./challenge-pool.ts";
import { ensureAssigned } from "./challenges.ts";
import { homeStorageCapacity, marketUnlockedFor } from "./player-wide.ts";
import { cfgOrFail } from "./contracts-core.ts";
import { kiContractQuote, signKiContract } from "./contracts-sign.ts";
import { activeHumans, politikKis, politikOff, politikSeason } from "./politik-core.ts";
import { kiAccess } from "./politik-ansehen.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const OPEN = ["angeboten", "angenommen", "erfuellt"];
const FAILED_CONTRACT = ["teilweise", "geplatzt", "gekuendigt", "rueckabgewickelt", "abgelaufen", "zurueckgezogen"];

export type GesuchRow = typeof tables.kiGesuch.$inferSelect;

function fail(code: string): never {
  throw new GameError(code);
}

const refPrice = () => balance.market.refPrice;

/** Ware zurück ins Lager des KI-Spielers (Treuhand auflösen); ohne Hafen verfällt sie. */
async function returnEscrow(tx: Tx, g: GesuchRow, nowMs: number): Promise<void> {
  const home = await homeBaseOf(tx, g.kiId);
  if (!home) return;
  const b = await lockBase(tx, home.id);
  if (!b) return;
  const state = settle(b.state, nowMs, balance, await modsOf(tx, b, nowMs));
  for (const [r, q] of Object.entries(g.reward as ResourceMap)) state.resources[r] = (state.resources[r] ?? 0) + q;
  await saveBase(tx, b.id, state);
}

/** Erfüllt: Lohn in den Heimathafen (bis zur Lagergrenze), belegter Tagesbefehl erledigt. */
async function payReward(tx: Tx, g: GesuchRow, nowMs: number): Promise<void> {
  const home = await homeBaseOf(tx, g.playerId);
  const b = home ? await lockBase(tx, home.id) : null;
  if (b) await saveBase(tx, b.id, deliverToStorage(b.state, g.reward as ResourceMap, nowMs, await modsOf(tx, b, nowMs)).state);
  if (g.challengeId !== null) {
    await tx.update(tables.dailyChallenge).set({ progress: sql`${tables.dailyChallenge.target}`, completedAt: new Date(nowMs) })
      .where(and(eq(tables.dailyChallenge.id, g.challengeId), isNull(tables.dailyChallenge.completedAt)));
  }
}

/** Abgelaufene Angebote verfallen, angenommene werden nach ihrem Vertrag abgerechnet. Rückgabe: geänderte Spieler. */
export async function settleGesuche(tx: Tx, nowMs: number, playerId?: number): Promise<number[]> {
  const g = tables.kiGesuch;
  const touched: number[] = [];
  const mine = playerId === undefined ? [] : [eq(g.playerId, playerId)];
  const stale = await tx.select().from(g).where(and(eq(g.status, "angeboten"), lte(g.expiresAt, new Date(nowMs)), ...mine)).for("update", { skipLocked: true });
  for (const r of stale) {
    await tx.update(g).set({ status: "verfallen", closedAt: new Date(nowMs) }).where(eq(g.id, r.id));
    await returnEscrow(tx, r, nowMs);
    touched.push(r.playerId);
  }
  const taken = await tx.select().from(g).where(and(eq(g.status, "angenommen"), ...mine)).for("update", { skipLocked: true });
  if (taken.length === 0) return touched;
  const ids = taken.map((r) => r.contractId).filter((x): x is number => x !== null);
  const cs = ids.length === 0 ? [] : await tx.select({ id: tables.marketContract.id, status: tables.marketContract.status, closedAt: tables.marketContract.closedAt })
    .from(tables.marketContract).where(inArray(tables.marketContract.id, ids));
  const byId = new Map(cs.map((c) => [c.id, c]));
  for (const r of taken) {
    const c = r.contractId === null ? null : byId.get(r.contractId);
    if (c?.status === "erfuellt") {
      const at = Math.min(nowMs, c.closedAt?.getTime() ?? nowMs);
      await tx.update(g).set({ status: "erfuellt", closedAt: new Date(at) }).where(eq(g.id, r.id));
      await payReward(tx, r, nowMs);
      touched.push(r.playerId);
    } else if (!c || FAILED_CONTRACT.includes(c.status)) {
      await tx.update(g).set({ status: "gescheitert", closedAt: new Date(nowMs) }).where(eq(g.id, r.id));
      await returnEscrow(tx, r, nowMs);
      touched.push(r.playerId);
    }
  }
  return touched;
}

/** Wartungslauf: abrechnen, verfallen lassen, neue Angebote des Spieltags. Rückgabe: Zahl neuer Angebote. */
export async function runGesuche(engine: Engine, nowMs: number): Promise<number> {
  const cfg = politikOf(balance)?.gesuche;
  if (!cfg || !balance.market.contracts) return 0;
  const res = await engine.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7340004)`);
    const touched = await settleGesuche(tx, nowMs);
    const offered = await offerGesuche(tx, nowMs);
    return { touched: [...new Set([...touched, ...offered])], n: offered.length };
  });
  if (res.touched.length > 0) engine.notify(res.touched, "market");
  return res.n;
}

interface KiSlot {
  id: number;
  name: string;
  profile: string;
  baseId: number;
  state: import("@tidefront/game-core").BaseState;
  capacity: number;
  credits: number;
  left: number;
  buys: string[];
}

/** Neue Angebote des Spieltags (in der Transaktion des Wartungslaufs). Rückgabe: Spieler mit neuem Angebot. */
export async function offerGesuche(tx: Tx, nowMs: number): Promise<number[]> {
  const p = politikOf(balance);
  const cfg = p?.gesuche;
  if (!p || !cfg || !cfg.kinds.liefern || (await politikOff(tx)).gesuche) return [];
  const s = await politikSeason(tx);
  if (!s) return [];
  const lastMs = Math.min(s.startMs + cfg.lastDay * DAY_MS * politikScale(s.startMs, s.endMs, balance), politikLimitMs(s.startMs, s.endMs, balance));
  if (nowMs >= lastMs) return [];
  const day = dayKey(nowMs);
  const g = tables.kiGesuch;
  const today = await tx.select().from(g).where(and(eq(g.seasonId, s.id), eq(g.day, day)));
  const has = new Set(today.map((r) => r.playerId));
  const humans = (await activeHumans(tx, nowMs)).filter((h) => !has.has(h.id));
  if (humans.length === 0) return [];
  const contracts = cfgOrFail();

  // KI-Spieler mit Budget: Heimathafen gesperrt (aufsteigend), Lager und Taler.
  const kis = (await politikKis(tx)).filter((k) => cfg.profiles.includes(k.profile) && (contracts.ki.profiles[k.profile]?.buys.length ?? 0) > 0);
  const homes = new Map<number, number>();
  for (const k of kis) {
    const h = await homeBaseOf(tx, k.id);
    if (h) homes.set(k.id, h.id);
  }
  const locked = await lockBases(tx, [...homes.values()]);
  const slots: KiSlot[] = [];
  for (const k of kis) {
    const b = locked.get(homes.get(k.id) ?? -1);
    if (!b) continue;
    const mods = await modsOf(tx, b, nowMs);
    const state = settle(b.state, nowMs, balance, mods);
    const used = today.filter((r) => r.kiId === k.id && OPEN.includes(r.status)).reduce((sum, r) => sum + r.value, 0);
    const { left } = gesuchBudget(productionRates(state, balance, mods, nowMs).buildingPerHour, used, refPrice(), cfg);
    const [t] = await tx.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, k.id));
    const credits = (t?.trader as { credits?: number } | null)?.credits ?? 0;
    slots.push({ id: k.id, name: k.name, profile: k.profile, baseId: b.id, state, capacity: storageCapacity(state, balance, mods), credits, left, buys: contracts.ki.profiles[k.profile]!.buys });
  }
  if (slots.length === 0) return [];

  // Reihum: zuerst, wer am längsten keines hatte.
  const last = await tx.select({ playerId: g.playerId, at: sql<string>`max(${g.offeredAt})` }).from(g).where(eq(g.seasonId, s.id)).groupBy(g.playerId);
  const lastAt = new Map(last.map((r) => [r.playerId, new Date(r.at).getTime()]));
  humans.sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0) || a.id - b.id);

  const out: number[] = [];
  for (const h of humans) {
    const home = await homeBaseOf(tx, h.id);
    if (!home) continue;
    const mods = await modsOf(tx, home, nowMs);
    const state = settle(home.state, nowMs, balance, mods);
    if (!(await marketUnlockedFor(tx, h.id, { id: home.id, state }))) continue;
    const perHour = productionRates(state, balance, mods, nowMs).buildingPerHour;
    const newbie = nowMs < (state.protection.createdAtMs ?? 0) + balance.protection.beginnerDays * DAY_MS;
    const dailyLimit = balance.market.dailyLimitShareOfStorage * (await homeStorageCapacity(tx, h.id, nowMs));
    const maxQty = dailyLimit * (newbie ? Math.min(cfg.newbieLimitShare, contracts.limitShare) : contracts.limitShare);
    for (const k of [...slots].sort((a, b) => b.left - a.left || a.id - b.id)) {
      if (!(await kiAccess(tx, k, h.id, nowMs)).gesuche) continue;
      const resource = k.buys.filter((r) => (perHour[r] ?? 0) > 0).sort((a, b) => (perHour[b] ?? 0) * refPrice()[b] - (perHour[a] ?? 0) * refPrice()[a])[0];
      if (!resource) continue;
      const qty = gesuchQty(perHour[resource] ?? 0, cfg, contracts.minQty, contracts.ki.quotaStep, maxQty);
      if (qty === null) continue;
      if (k.credits < qty * (refPrice()[resource] ?? 1) * 1.5) continue; // die KI muss den Kaufpreis in Treuhand geben können
      const r = gesuchReward(perHour, k.state.resources, k.capacity, refPrice(), cfg);
      if (!r || r.value > k.left) continue;
      for (const [res, q] of Object.entries(r.reward)) k.state.resources[res] = (k.state.resources[res] ?? 0) - q;
      k.left -= r.value;
      k.credits -= qty * (refPrice()[resource] ?? 1);
      await tx.insert(g).values({
        seasonId: s.id, playerId: h.id, kiId: k.id, day, kind: "liefern", status: "angeboten", resource, qty, reward: r.reward, value: r.value,
        offeredAt: new Date(nowMs), expiresAt: new Date(nowMs + cfg.deadlineHours * HOUR_MS),
      }).onConflictDoNothing();
      out.push(h.id);
      break;
    }
  }
  for (const k of slots) await saveBase(tx, k.baseId, k.state);
  return out;
}

/** Belegt einen offenen Tagesbefehl des Tages (bevorzugt Stufe slot): Art gesuch, Ziel 1, Lohn kommt vom KI-Spieler. */
async function occupySlot(tx: Tx, playerId: number, gesuchId: number, nowMs: number): Promise<number | null> {
  const cfg = politikOf(balance)!.gesuche;
  const day = dayKey(nowMs);
  await ensureAssigned(tx, playerId, day, nowMs);
  const dc = tables.dailyChallenge;
  const open = await tx.select().from(dc).where(and(eq(dc.playerId, playerId), eq(dc.day, day), isNull(dc.completedAt), isNull(dc.claimedAt)))
    .orderBy(asc(dc.slot)).for("update");
  if (open.some((r) => r.kind === "gesuch")) return null;
  const pick = open.find((r) => r.slot === cfg.slot) ?? open[0];
  if (!pick) return null;
  await tx.update(dc).set({ kind: "gesuch", param: String(gesuchId), target: 1, progress: 0, reward: {} }).where(eq(dc.id, pick.id));
  return pick.id;
}

/**
 * Gesuch annehmen: schließt den Liefervertrag (Verkauf an den KI-Spieler, kürzeste Laufzeit) im selben Befehl und
 * belegt einen Tagesbefehl-Platz. Codes: no_gesuch, gesuch_gone, gesuche_off und die des KI-Vertrags.
 */
export async function acceptGesuch(engine: Engine, playerId: number, key: string, gesuchId: number, baseId?: number) {
  const [g] = await engine.db.select().from(tables.kiGesuch).where(eq(tables.kiGesuch.id, gesuchId));
  if (!g || g.playerId !== playerId) return { ok: false as const, code: "no_gesuch" };
  if (g.status !== "angeboten" || g.expiresAt.getTime() <= Date.now()) return { ok: false as const, code: "gesuch_gone" };
  const profile = (await politikKis(engine.db)).find((k) => k.id === g.kiId)?.profile;
  const days = profile ? cfgOrFail().ki.profiles[profile]?.days[0] : undefined;
  if (!days) return { ok: false as const, code: "no_ki" };
  const input = { kiId: g.kiId, side: "sell" as const, resource: g.resource, qty: g.qty, days, baseId };
  let expectedPrice: number;
  try {
    const q = await kiContractQuote(engine, playerId, input);
    expectedPrice = q.avgPrice;
  } catch (err) {
    if (err instanceof GameError) return { ok: false as const, code: err.code };
    throw err;
  }
  return signKiContract(engine, playerId, key, { ...input, expectedPrice }, {
    before: async (ctx: Ctx) => {
      const [row] = await ctx.tx.select().from(tables.kiGesuch).where(eq(tables.kiGesuch.id, gesuchId)).for("update");
      if (!row || row.playerId !== playerId) fail("no_gesuch");
      if (row.status !== "angeboten" || row.expiresAt.getTime() <= ctx.nowMs) fail("gesuch_gone");
    },
    after: async (ctx: Ctx, ids: number[]) => {
      const challengeId = await occupySlot(ctx.tx, playerId, gesuchId, ctx.nowMs);
      await ctx.tx.update(tables.kiGesuch).set({ status: "angenommen", contractId: ids[0], challengeId, acceptedAt: new Date(ctx.nowMs) }).where(eq(tables.kiGesuch.id, gesuchId));
    },
  });
}

/** Gesuch ablehnen: der Lohn geht in das Lager des KI-Spielers zurück. Codes: no_gesuch, gesuch_gone. */
export function declineGesuch(engine: Engine, playerId: number, key: string, gesuchId: number) {
  return runCommand<{ ok: true }>(engine, playerId, key, "gesuchAblehnen", async (ctx) => {
    const [g] = await ctx.tx.select().from(tables.kiGesuch).where(eq(tables.kiGesuch.id, gesuchId)).for("update");
    if (!g || g.playerId !== playerId) fail("no_gesuch");
    if (g.status !== "angeboten") fail("gesuch_gone");
    await ctx.tx.update(tables.kiGesuch).set({ status: "abgelehnt", closedAt: new Date(ctx.nowMs) }).where(eq(tables.kiGesuch.id, g.id));
    await returnEscrow(ctx.tx, g, ctx.nowMs);
    ctx.notify.push([[playerId], "market"]);
    return { ok: true as const };
  });
}

/** Gesuche des Spielers in dieser Saison (neueste zuerst), Wert zum Richtwert. */
export async function gesucheOf(tx: Tx, playerId: number, seasonId: number): Promise<GesuchRow[]> {
  const g = tables.kiGesuch;
  return tx.select().from(g).where(and(eq(g.seasonId, seasonId), eq(g.playerId, playerId))).orderBy(sql`${g.offeredAt} desc`).limit(20);
}

export const rewardValue = (m: ResourceMap) => Math.round(valueOf(m, balance.market.refPrice));
