// KI-Spieler: Börse, Spielerhandel und Gründung – alles über die vorhandenen Befehle
// (trade, createOffer/acceptOffer, launchMission zur Gründung, train). Rohstofffelder: bots-fields.ts.
import { and, eq, inArray } from "drizzle-orm";
import {
  allowedBases,
  commandPoints,
  harborMarketUnlocked,
  market as marketCore,
  productionRates,
  recommendEscort,
  startTraining,
  storageCapacity,
  trainingCost,
  type BaseState,
  type Modifiers,
  type ResourceMap,
} from "@tidefront/game-core";
import { hexDistanceKm, nearestTradePortBySea } from "@tidefront/world";
import { tables } from "@tidefront/db";
import { balance, marketBalance } from "./context.ts";
import { train, trade } from "./commands.ts";
import { marketQuote, marketView, missionPreview } from "./views.ts";
import { acceptOffer, createOffer, offersView } from "./player-trade.ts";
import { botMarketPlan, maxLots, nextBuildNeed } from "./bots-market.ts"; // Welle 2: Börse nach Stunden Produktion
import { contractsTurn } from "./bots-contracts.ts"; // Lieferverträge: günstige Vertragsangebote von Spielern
import { launchMission } from "./commands.ts";
import { FOUNDING_TYPE } from "./expansion.ts";
import { coastFields } from "./bots-core.ts";
import { fmtInt, nameOf } from "./names.ts";
import type { TurnCtx } from "./bots-war.ts";
import { nest6FuelNeed } from "./bots-nest6.ts"; // v1.37
import type { BaseRow } from "./store.ts";

type Base = BaseRow & { state: BaseState };

const ref = (r: string) => balance.market.refPrice[r] ?? 1;

/**
 * Börse (Welle 2): Überschuss über HOLD_HOURS Produktion und den Bedarf der nächsten Ausbauten verkaufen, knappe Ware
 * (unter BUY_BELOW_HOURS Produktion) zukaufen – Regeln in bots-market.ts. Ein Geschäft je Richtung und Zug.
 */
export async function marketTurn(c: TurnCtx, base: Base, mods: Modifiers): Promise<void> {
  if (!harborMarketUnlocked(base.state, balance)) return;
  const view = await marketView(c.engine, c.bot.id);
  const room: ResourceMap = {}, price: ResourceMap = {};
  for (const x of view.resources) {
    room[x.id] = Math.max(0, x.dailyLimit - x.dailyUsed - (x.dailyReserved ?? 0));
    price[x.id] = x.price ?? ref(x.id);
  }
  // v1.37: Rüstungsplan Nest 6 – Treibstoff für die Fahrt zur Inselfestung nicht verkaufen, fehlenden zukaufen.
  const fuelNeed = c.nest6Hold === base.id ? nest6FuelNeed(base, mods) : 0;
  const need = nextBuildNeed(base.state);
  if (fuelNeed > 0) need.treibstoff = Math.max(need.treibstoff ?? 0, fuelNeed);
  const plan = botMarketPlan({
    stock: base.state.resources, perHour: productionRates(base.state, balance, mods, c.nowMs).perHour, need,
    room, price, maxLot: maxLots(), credits: view.credits - (c.creditReserve ?? 0), trader: c.cfg.trade,
  });
  for (const x of plan.sell) await doTrade(c, base, "sell", x.resource, x.qty);
  const short = Math.floor(fuelNeed - (base.state.resources.treibstoff ?? 0));
  if (short > 0 && (room.treibstoff ?? 0) > 0) await doTrade(c, base, "buy", "treibstoff", Math.min(short, Math.floor(room.treibstoff), maxLots().treibstoff ?? short), mods);
  else if (plan.buy) await doTrade(c, base, "buy", plan.buy.resource, plan.buy.qty, mods);
}

/** Ab diesem Warenwert (Richtpreis) nehmen KI-Spieler bei Börsenkäufen das empfohlene Geleit, wenn Schiffe daheim sind. */
export const BOT_ESCORT_MIN_VALUE = 10000;

/** Empfohlenes Geleit für einen großen Börsenkauf (ENTSCHEIDUNGEN-5.md „Empfohlenes Geleit“); null: ohne Geleit. */
export function botMarketEscort(base: Base, resource: string, qty: number, mods: Modifiers): Record<string, number> | null {
  const value = qty * ref(resource);
  if (value < BOT_ESCORT_MIN_VALUE) return null;
  const port = nearestTradePortBySea(base);
  const a = recommendEscort({
    value, riskKm: marketCore.deliveryRiskKm(marketBalance.market, port.distanceKm), market: true,
    trip: { km: port.distanceKm, awayHours: marketCore.deliveryTravelMs(marketBalance.market, port.distanceKm) / 3600000 },
    home: base.state.units, modifiers: mods, commandPoints: commandPoints(base.state, balance), fuelAvailable: base.state.resources.treibstoff,
  }, balance);
  return a.status === "ok" && !a.fuelShort ? a.units : null;
}

/** Ein Börsengeschäft zum aktuellen Kurs; Rückgabe: erhaltene Taler (Verkauf), sonst 0. */
async function doTrade(c: TurnCtx, base: Base, side: "buy" | "sell", resource: string, qty: number, mods?: Modifiers): Promise<number> {
  const q = await marketQuote(c.engine, { side, resource, qty });
  if (!q.ok) return 0;
  // Große Käufe mit empfohlenem Geleit (Schiffe daheim); scheitert das Geleit, ohne.
  const escort = side === "buy" && mods ? botMarketEscort(base, resource, qty, mods) : null;
  let r = await trade(c.engine, c.bot.id, c.key("trade"), { side, resource, qty, expectedPrice: q.executionPrice, baseId: base.id, ...(escort ? { escort } : {}) });
  const escorted = r.ok && !!escort;
  if (!r.ok && escort) r = await trade(c.engine, c.bot.id, c.key("trade"), { side, resource, qty, expectedPrice: q.executionPrice, baseId: base.id });
  if (!r.ok) return 0;
  c.log.push(`Börse: ${fmtInt(qty)} ${nameOf(resource)} ${side === "sell" ? "verkauft" : "gekauft"}${escorted ? " (mit Geleit)" : ""}.`);
  return side === "sell" ? q.totalCredits : 0;
}

/** Spielerhandel (Händler): faire fremde Angebote annehmen, eigene Angebote für Überschuss einstellen. */
export async function offersTurn(c: TurnCtx, base: Base, mods: Modifiers): Promise<void> {
  if (!c.cfg.trade || !harborMarketUnlocked(base.state, balance)) return;
  await contractsTurn(c, base, mods);
  const cap = storageCapacity(base.state, balance, mods);
  const stock = (r: string) => base.state.resources[r] ?? 0;
  const view = await offersView(c.engine, c.bot.id, base.id);
  const isRes = (a: string) => balance.resources.includes(a);
  // Annehmen: wir geben o.want, bekommen o.give – mindestens gleichwertig zum Richtwert und tragbar.
  for (const o of view.open) {
    if (o.own || !isRes(o.give) || !isRes(o.want)) continue;
    if (o.wantQty > 0.5 * stock(o.want)) continue;
    if (o.giveQty * ref(o.give) < o.wantQty * ref(o.want)) continue;
    if (stock(o.give) + o.giveQty > 0.9 * cap) continue;
    const r = await acceptOffer(c.engine, c.bot.id, c.key("accept"), o.id, undefined, base.id);
    if (r.ok) {
      c.log.push(`Handel: Angebot von ${o.seller.name} angenommen (${fmtInt(o.giveQty)} ${nameOf(o.give)} gegen ${fmtInt(o.wantQty)} ${nameOf(o.want)}).`);
      return;
    }
  }
  const mine = view.open.filter((o) => o.own).length;
  if (mine >= 2 || c.rand() < 0.5) return;
  const byFill = [...balance.resources].sort((a, b) => stock(b) / cap - stock(a) / cap);
  const give = byFill[0];
  const want = byFill[byFill.length - 1];
  if (stock(give) / cap < 0.5 || give === want) return;
  const giveQty = Math.max(200, Math.floor(stock(give) * 0.1));
  const wantQty = Math.max(1, Math.round((giveQty * ref(give)) / ref(want) * 1.05));
  const r = await createOffer(c.engine, c.bot.id, c.key("offer"), { give, giveQty, want, wantQty, visibility: "public", baseId: base.id });
  if (r.ok) c.log.push(`Handel: Angebot ${fmtInt(giveQty)} ${nameOf(give)} gegen ${fmtInt(wantQty)} ${nameOf(want)} eingestellt.`);
}

/** Hinweise der Gründung an die Wirtschaft des Heimathafens (bots-plan.ts: Rücklage, Vorrang, freie Werft). */
export interface ExpansionPlan { reserve?: ResourceMap; boost?: string[]; keepFree?: string[] }

/**
 * Gründung: ab expandFromCommandLevel ein Kolonieschiff bauen und zu einem freien Küstenfeld schicken. Läuft vor der
 * Wirtschaft des Zugs: fehlen Werft- oder Hafenkommandantur-Stufe, bekommen sie Vorrang (schon eine Stufe der
 * Kommandozentrale vorher); fehlen Rohstoffe, werden die Kosten zurückgelegt und die Werft bleibt frei (früher
 * belegten Korvetten die Werft und nahmen die Rohstoffe – kein Bot gründete einen zweiten Hafen).
 */
export async function expansionTurn(c: TurnCtx, bases: Base[], mods: Map<number, Modifiers>): Promise<ExpansionPlan> {
  const home = bases.find((b) => b.isHome);
  const exp = balance.expansion;
  if (!home || !exp) return {};
  const kz = home.state.buildings.kommandozentrale ?? 0;
  if (kz < c.cfg.expandFromCommandLevel - 1) return {};
  // Eine Stufe vor der Schwelle wird nur vorbereitet (der zweite Hafen ist dann meist noch nicht freigeschaltet).
  const prep = kz < c.cfg.expandFromCommandLevel;
  if (bases.length >= (prep ? Math.max(2, allowedBases(home.state, balance)) : allowedBases(home.state, balance))) return {};
  const pending = await c.engine.db.select({ id: tables.mission.id }).from(tables.mission)
    .where(and(eq(tables.mission.playerId, c.bot.id), eq(tables.mission.type, FOUNDING_TYPE), inArray(tables.mission.status, ["outbound"])));
  if (pending.length > 0) return {};
  const ship = balance.units[exp.colonyShip];
  const yard = ship?.builtIn ?? "werft";
  const withShip = bases.find((b) => (b.state.units[exp.colonyShip] ?? 0) > 0);
  if (!withShip) {
    const queued = bases.some((b) => b.state.trainingQueue.some((o) => o.id === exp.colonyShip));
    if (queued) return {};
    // Vorbereitung: Werft und Hafenkommandantur auf die nötige Stufe, Lager groß genug für das Schiff.
    const boost: string[] = [];
    if ((home.state.buildings[yard] ?? 0) < (ship?.requiresLevel ?? 1)) boost.push(yard);
    if ((home.state.buildings.hafenkommandantur ?? 0) < exp.harborLevelForShip) boost.push("hafenkommandantur");
    const cost = trainingCost(exp.colonyShip, 1, balance);
    if (Object.values(cost).some((n) => n > storageCapacity(home.state, balance, mods.get(home.id)))) boost.push("lagerkomplex");
    if (boost.length > 0 || prep) return { boost };
    const r = startTraining(home.state, exp.colonyShip, 1, c.nowMs, balance, mods.get(home.id));
    if (!r.ok) return r.code === "insufficient_resources" || r.code === "queue_busy" ? { reserve: cost, keepFree: [yard] } : {};
    const t = await train(c.engine, c.bot.id, c.key("colonyship"), exp.colonyShip, 1, home.id);
    if (t.ok) c.log.push("Kolonieschiff in Auftrag gegeben.");
    return {};
  }
  const taken = new Set((await c.engine.db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base)).map((b) => `${b.col},${b.row}`));
  const sites = coastFields()
    .filter((f) => !taken.has(`${f.col},${f.row}`))
    .map((f) => ({ ...f, d: hexDistanceKm(withShip, f) }))
    .filter((f) => f.d >= 300 && f.d <= exp.maxRangeKm * 0.8)
    .sort((a, b) => Math.abs(a.d - 450) - Math.abs(b.d - 450));
  const start = Math.floor(c.rand() * Math.min(20, sites.length));
  for (const f of [...sites.slice(start, start + 8), ...sites.slice(0, 4)]) {
    const input = { type: FOUNDING_TYPE, units: { [exp.colonyShip]: 1 }, col: f.col, row: f.row, baseId: withShip.id };
    const p = await missionPreview(c.engine, c.bot.id, input);
    if (!p.ok) continue;
    const r = await launchMission(c.engine, c.bot.id, c.key("found"), input);
    if (r.ok) {
      c.log.push(`Kolonieschiff läuft zur Gründung auf Feld ${f.col}/${f.row} aus.`);
      return {};
    }
  }
  return {};
}
