// KI-Spieler: Börse, Spielerhandel und Gründung – alles über die vorhandenen Befehle
// (trade, createOffer/acceptOffer, launchMission zur Gründung, train). Rohstofffelder: bots-fields.ts.
import { and, eq, inArray } from "drizzle-orm";
import {
  allowedBases,
  harborMarketUnlocked,
  startTraining,
  storageCapacity,
  type BaseState,
  type Modifiers,
} from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables } from "@tidefront/db";
import { balance } from "./context.ts";
import { train, trade } from "./commands.ts";
import { marketQuote, marketView, missionPreview } from "./views.ts";
import { acceptOffer, createOffer, offersView } from "./player-trade.ts";
import { launchMission } from "./commands.ts";
import { FOUNDING_TYPE } from "./expansion.ts";
import { coastFields } from "./bots-core.ts";
import type { TurnCtx } from "./bots-war.ts";
import type { BaseRow } from "./store.ts";

type Base = BaseRow & { state: BaseState };

const ref = (r: string) => balance.market.refPrice[r] ?? 1;

/** Börse: Überschuss verkaufen (alle), knappe Ware zukaufen (Händler). Ein Geschäft je Richtung und Zug. */
export async function marketTurn(c: TurnCtx, base: Base, mods: Modifiers): Promise<void> {
  if (!harborMarketUnlocked(base.state, balance)) return;
  const cap = storageCapacity(base.state, balance, mods);
  const view = await marketView(c.engine, c.bot.id);
  const room = (r: string) => {
    const x = view.resources.find((y) => y.id === r);
    return x ? Math.max(0, x.dailyLimit - x.dailyUsed) : 0;
  };
  const fill = (r: string) => (base.state.resources[r] ?? 0) / cap;
  const byFill = [...balance.resources].sort((a, b) => fill(a) - fill(b));
  const short = fill(byFill[0]) < (c.cfg.trade ? 0.25 : 0.12) ? byFill[0] : null;
  // Verkaufen: Händler früh, die anderen bei vollem Lager oder wenn eine Ressource knapp ist.
  const sellFrom = c.cfg.trade ? 0.5 : short ? 0.5 : 0.85;
  const over = [...byFill].reverse().find((r) => fill(r) > sellFrom && r !== short);
  let credits = view.credits;
  if (over) {
    const qty = Math.floor(Math.min((base.state.resources[over] ?? 0) * 0.3, room(over)));
    if (qty >= 100) credits += await doTrade(c, base, "sell", over, qty);
  }
  if (!short || (c.cfg.trade && c.rand() < c.cfg.noise)) return;
  if (credits > 500) {
    const price = view.resources.find((y) => y.id === short)?.price ?? ref(short);
    const qty = Math.floor(Math.min((credits * (c.cfg.trade ? 0.6 : 0.4)) / price, 0.25 * cap, room(short)));
    if (qty >= 100) await doTrade(c, base, "buy", short, qty);
  }
}

/** Ein Börsengeschäft zum aktuellen Kurs; Rückgabe: erhaltene Kredite (Verkauf), sonst 0. */
async function doTrade(c: TurnCtx, base: Base, side: "buy" | "sell", resource: string, qty: number): Promise<number> {
  const q = await marketQuote(c.engine, { side, resource, qty });
  if (!q.ok) return 0;
  const r = await trade(c.engine, c.bot.id, c.key("trade"), { side, resource, qty, expectedPrice: q.executionPrice, baseId: base.id });
  if (!r.ok) return 0;
  c.log.push(`Börse: ${qty} ${resource} ${side === "sell" ? "verkauft" : "gekauft"}.`);
  return side === "sell" ? q.totalCredits : 0;
}

/** Spielerhandel (Händler): faire fremde Angebote annehmen, eigene Angebote für Überschuss einstellen. */
export async function offersTurn(c: TurnCtx, base: Base, mods: Modifiers): Promise<void> {
  if (!c.cfg.trade || !harborMarketUnlocked(base.state, balance)) return;
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
      c.log.push(`Handel: Angebot von ${o.seller.name} angenommen (${o.giveQty} ${o.give} gegen ${o.wantQty} ${o.want}).`);
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
  if (r.ok) c.log.push(`Handel: Angebot ${giveQty} ${give} gegen ${wantQty} ${want} eingestellt.`);
}

/** Gründung: Kolonieschiff bauen lassen und zu einem freien Küstenfeld schicken (ab einer Stufe der Kommandozentrale). */
export async function expansionTurn(c: TurnCtx, bases: Base[], mods: Map<number, Modifiers>): Promise<void> {
  const home = bases.find((b) => b.isHome);
  const exp = balance.expansion;
  if (!home || !exp) return;
  if ((home.state.buildings.kommandozentrale ?? 0) < c.cfg.expandFromCommandLevel) return;
  if (bases.length >= allowedBases(home.state, balance)) return;
  const pending = await c.engine.db.select({ id: tables.mission.id }).from(tables.mission)
    .where(and(eq(tables.mission.playerId, c.bot.id), eq(tables.mission.type, FOUNDING_TYPE), inArray(tables.mission.status, ["outbound"])));
  if (pending.length > 0) return;
  const withShip = bases.find((b) => (b.state.units[exp.colonyShip] ?? 0) > 0);
  if (!withShip) {
    const queued = bases.some((b) => b.state.trainingQueue.some((o) => o.id === exp.colonyShip));
    if (queued) return;
    const r = startTraining(home.state, exp.colonyShip, 1, c.nowMs, balance, mods.get(home.id));
    if (!r.ok) return;
    const t = await train(c.engine, c.bot.id, c.key("colonyship"), exp.colonyShip, 1, home.id);
    if (t.ok) c.log.push("Kolonieschiff in Auftrag gegeben.");
    return;
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
      return;
    }
  }
}
