// Lieferverträge (v1.31): Abwicklung als Ereignis contract_due (Schritte remind, settle, grace, expire). Bei Fälligkeit
// wird erfüllt, so weit Kredite und Ware reichen; sonst 12 h Nachfrist, danach anteilig mit Strafe auf den unerfüllten
// Teil. Neue Verträge liefern per Konvoi über die Seewege (Art „vertrag“: abfangbar, Geleit des Käufers; KI-Profile mit
// convoy: Albers, Falkenberg, Rotbart); alte Verträge mit delivery „abstrakt“ liefern weiter sofort ins Lager.
// Lieferungen zählen ins gleitende Tageslimit und in die Handelsbilanz.
import { eq, inArray, sql } from "drizzle-orm";
import { deliverCargo, settle, market as marketCore, type BaseState, type Counts } from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import { balance, GameError, type NoticeJob } from "./context.ts";
import type { HandlerResult } from "./events.ts";
import { modsOf } from "./modifiers.ts";
import { homeBaseOf, lockBases, readBase, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import { siegeEffects } from "./world-events.ts";
import { attachTradeEscort, createConvoy, tradeBlocked } from "./naval.ts";
import { travelMs } from "./player-trade.ts";
import { trackProgress } from "./challenges.ts";
import { recordTies } from "./pvp-ties.ts";
import { systemMessage } from "./alliance-core.ts";
import { fmtInt, nameOf } from "./names.ts";
import {
  CONTRACT_EVENT, cents, cfgOrFail, escrowAccount, journal, lockTraders, playerAcc, saveTrader, withCredits, type ContractRow, type Line,
} from "./contracts-core.ts";

const HOUR_MS = 3_600_000;
type Notes = HandlerResult["notify"];
type Trader = Omit<marketCore.TraderState, "stock">;

/** Die KI eines KI-Vertrags (der Abschließende ist immer der Mensch), sonst null. */
export function kiOf(c: Pick<ContractRow, "kind" | "buyerId" | "sellerId" | "proposerId">): number | null {
  if (c.kind !== "ki") return null;
  return c.proposerId === c.buyerId ? c.sellerId : c.buyerId;
}

const credText = (c: number) => (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const contractTitle = (c: Pick<ContractRow, "qty" | "resource" | "tranche" | "tranches">) =>
  `${fmtInt(c.qty)} ${nameOf(c.resource)}${c.tranches > 1 ? ` (Abo, Tranche ${c.tranche}/${c.tranches})` : ""}`;

function push(playerId: number, title: string, body: string, id: number): NoticeJob {
  return { playerId, notice: { kind: "delivery", title, body, url: "/?tab=boerse", tag: `vertrag-${id}` } };
}

/** Hafen eines Vertragspartners: der beim Abschluss gewählte, solange er ihm gehört, sonst sein Heimathafen. */
async function partyBase(tx: Tx, playerId: number | null, baseId: number | null): Promise<BaseRow | null> {
  if (playerId === null) return null;
  const b = baseId !== null ? await readBase(tx, baseId) : null;
  return b && b.playerId === playerId ? b : homeBaseOf(tx, playerId);
}

/** Fehlbetrag 6 h vor Fälligkeit: Kredite (Käufer) bzw. Ware (Verkäufer). */
async function remind(tx: Tx, c: ContractRow, due: number, notify: Notes, jobs: NoticeJob[]): Promise<void> {
  const ki = kiOf(c);
  const cfg = cfgOrFail();
  if (c.buyerId !== null && c.buyerId !== ki) {
    const [p] = await tx.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, c.buyerId));
    const need = marketCore.ceilToCents(c.qty * c.buyerUnit) - c.buyerDepositCents - cents((p?.trader as Trader | undefined)?.credits ?? 0);
    if (need > 0) {
      const body = `In ${cfg.remindHours} Stunden ist dein Liefervertrag über ${contractTitle(c)} fällig. Es fehlen ${credText(need)} Kredite. ` +
        `Reicht es bei Fälligkeit nicht, gilt eine Nachfrist von ${cfg.graceHours} Stunden; danach wird anteilig erfüllt und ${Math.round(cfg.penaltyShare * 100)} % des nicht erfüllten Werts verfallen.`;
      await systemMessage(tx, notify, [c.buyerId], "Liefervertrag: Kredite fehlen", body);
      jobs.push(push(c.buyerId, "Liefervertrag: Kredite fehlen", body, c.id));
    }
  }
  if (c.sellerId !== null && c.sellerId !== ki) {
    const b = await partyBase(tx, c.sellerId, c.sellerBaseId);
    const have = b ? Math.floor(settle(b.state, due, balance, await modsOf(tx, b, due)).resources[c.resource] ?? 0) : 0;
    if (have < c.qty) {
      const body = `In ${cfg.remindHours} Stunden musst du ${contractTitle(c)} liefern. Im Hafen fehlen ${fmtInt(c.qty - have)} ${nameOf(c.resource)}. ` +
        `Reicht es bei Fälligkeit nicht, gilt eine Nachfrist von ${cfg.graceHours} Stunden; danach wird anteilig erfüllt und ${Math.round(cfg.penaltyShare * 100)} % des nicht erfüllten Werts verfallen.`;
      await systemMessage(tx, notify, [c.sellerId], "Liefervertrag: Ware fehlt", body);
      jobs.push(push(c.sellerId, "Liefervertrag: Ware fehlt", body, c.id));
    }
  }
}

/** game_event contract_due. */
export async function contractDue(tx: Tx, ev: { payload: Record<string, unknown> }, due: number): Promise<HandlerResult> {
  const notify: Notes = [];
  const jobs: NoticeJob[] = [];
  const [c] = await tx.select().from(tables.marketContract).where(eq(tables.marketContract.id, Number(ev.payload.contractId))).for("update");
  const step = String(ev.payload.step);
  if (!c) return { notify };
  if (step === "remind" && c.status === "offen") await remind(tx, c, due, notify, jobs);
  else if (step === "settle" && c.status === "offen") await settleNow(tx, c, due, false, notify, jobs);
  else if (step === "grace" && c.status === "nachfrist") await settleNow(tx, c, due, true, notify, jobs);
  else if (step === "expire" && c.status === "angeboten") {
    const { closeProposal } = await import("./contracts-player.ts");
    await closeProposal(tx, c, "abgelaufen", due, notify);
  }
  return { notify, push: jobs };
}

/** Abwicklung. final: Ende der Nachfrist (dann anteilig mit Strafe, sonst bei Fehlbetrag erst Nachfrist). */
async function settleNow(tx: Tx, c: ContractRow, due: number, final: boolean, notify: Notes, jobs: NoticeJob[]): Promise<void> {
  const cfg = cfgOrFail();
  const ki = kiOf(c);
  const sellerHuman = c.sellerId !== null && c.sellerId !== ki;
  const buyerHuman = c.buyerId !== null && c.buyerId !== ki;
  const sRow = await partyBase(tx, c.sellerId, c.sellerBaseId);
  const bRow = await partyBase(tx, c.buyerId, c.buyerBaseId);
  const bases = await lockBases(tx, [sRow?.id, bRow?.id].filter((x): x is number => x !== undefined));
  const sellerBase = sRow ? bases.get(sRow.id) ?? null : null;
  const buyerBase = bRow ? bases.get(bRow.id) ?? null : null;
  // Belagerung (Kauflieferung) bzw. Blockade (Verkaufslieferung des Spielers): höchstens holdHours zurückgehalten.
  if (due < c.settleAt.getTime() + cfg.holdHours * HOUR_MS) {
    const held = (buyerHuman && buyerBase && (await siegeEffects(tx, buyerBase.id, due))?.marketBlocked) ||
      (sellerHuman && sellerBase && (await tradeBlocked(tx, sellerBase.id, "sell", due)));
    if (held) {
      await scheduleEvent(tx, CONTRACT_EVENT, due + HOUR_MS, { contractId: c.id, step: final ? "grace" : "settle" }, buyerBase?.id ?? null);
      return;
    }
  }
  const traders = await lockTraders(tx, [c.buyerId, c.sellerId].filter((x): x is number => x !== null));
  const states = new Map<number, BaseState>();
  const stateOf = async (b: BaseRow) => {
    if (!states.has(b.id)) states.set(b.id, settle(b.state, due, balance, await modsOf(tx, b, due)));
    return states.get(b.id)!;
  };
  const goods = sellerHuman ? (sellerBase ? Math.floor((await stateOf(sellerBase)).resources[c.resource] ?? 0) : 0) : c.escrowQty;
  const buyerTrader = c.buyerId !== null ? traders.get(c.buyerId) : undefined;
  const r = marketCore.settleContract({
    qty: c.qty, buyerUnit: c.buyerUnit, sellerUnit: c.sellerUnit, buyerDepositCents: c.buyerDepositCents, sellerPledgeCents: c.sellerPledgeCents,
    goodsAvailable: goods, buyerCreditsCents: buyerHuman && buyerTrader ? cents(buyerTrader.credits) : 0, penaltyShare: cfg.penaltyShare,
  });
  if (!r.full && !final) {
    const until = due + cfg.graceHours * HOUR_MS;
    await tx.update(tables.marketContract).set({ status: "nachfrist", graceUntil: new Date(until) }).where(eq(tables.marketContract.id, c.id));
    await scheduleEvent(tx, CONTRACT_EVENT, until, { contractId: c.id, step: "grace" }, buyerBase?.id ?? sellerBase?.id ?? null);
    const who: [number, string][] = [];
    if (r.buyerShort > 0 && buyerHuman) who.push([c.buyerId!, `Deine Kredite reichen nur für ${fmtInt(c.qty - r.buyerShort)} von ${fmtInt(c.qty)}.`]);
    if (r.sellerShort > 0 && sellerHuman) who.push([c.sellerId!, `Im Hafen liegen nur ${fmtInt(c.qty - r.sellerShort)} von ${fmtInt(c.qty)} ${nameOf(c.resource)}.`]);
    for (const [id, why] of who) {
      const body = `Dein Liefervertrag über ${contractTitle(c)} ist fällig. ${why} Nachfrist ${cfg.graceHours} Stunden – danach wird anteilig erfüllt, ` +
        `${Math.round(cfg.penaltyShare * 100)} % des nicht erfüllten Werts verfallen.`;
      await systemMessage(tx, notify, [id], "Liefervertrag: Nachfrist", body);
      jobs.push(push(id, "Liefervertrag: Nachfrist", body, c.id));
    }
    notify.push([[c.buyerId, c.sellerId].filter((x): x is number => x !== null && x !== ki), "market"]);
    return;
  }

  // --- Buchungen -------------------------------------------------------------
  const lines: Line[] = [];
  const esc = escrowAccount(c.id);
  const penaltyTo = ki !== null ? playerAcc(ki) : "fees";
  lines.push([esc, "credits", -(c.buyerDepositCents + c.sellerPledgeCents)]);
  const credit = new Map<number, number>();
  const addC = (id: number | null, v: number) => { if (id !== null && v !== 0) credit.set(id, (credit.get(id) ?? 0) + v); };
  addC(c.buyerId, -r.fromAccountCents + r.buyerRefundCents);
  lines.push([playerAcc(c.buyerId!), "credits", -r.fromAccountCents + r.buyerRefundCents]);
  addC(c.sellerId, r.sellerGetsCents + r.sellerPledgeRefundCents);
  lines.push([playerAcc(c.sellerId!), "credits", r.sellerGetsCents + r.sellerPledgeRefundCents]);
  const pen = r.buyerPenaltyCents + r.sellerPenaltyCents;
  if (ki !== null) addC(ki, pen);
  lines.push([penaltyTo, "credits", pen], ["fees", "credits", r.feeCents]);

  // Ware: vom Verkäufer (Hafen) bzw. aus der Treuhand der KI; nicht Geliefertes der KI zurück in ihr Lager.
  if (sellerHuman) {
    if (sellerBase && r.qty > 0) (await stateOf(sellerBase)).resources[c.resource] -= r.qty;
    lines.push([playerAcc(c.sellerId!), c.resource, -r.qty]);
  } else {
    lines.push([esc, c.resource, -c.escrowQty]);
    const back = c.escrowQty - r.qty;
    if (back > 0 && sellerBase) {
      states.set(sellerBase.id, deliverCargo(await stateOf(sellerBase), { [c.resource]: back }, due, balance));
      lines.push([playerAcc(c.sellerId!), c.resource, back]);
    }
  }
  let deliveryId: string | null = null;
  let arriveMs = due;
  if (r.qty > 0 && c.delivery === "konvoi" && sellerBase && buyerBase) {
    deliveryId = `mc-${c.id}`;
    arriveMs = Math.max(c.dueAt.getTime(), due + travelMs(sellerBase, buyerBase));
    await tx.insert(tables.delivery).values({ id: deliveryId, playerId: c.buyerId!, baseId: buyerBase.id, resource: c.resource, qty: r.qty, departAt: new Date(due), arriveAt: new Date(arriveMs) });
    await scheduleEvent(tx, "delivery_arrive", arriveMs, { deliveryId }, buyerBase.id);
    lines.push([`delivery:${deliveryId}`, c.resource, r.qty]);
  } else if (r.qty > 0 && buyerBase) {
    states.set(buyerBase.id, deliverCargo(await stateOf(buyerBase), { [c.resource]: r.qty }, due, balance));
    lines.push([playerAcc(c.buyerId!), c.resource, r.qty]);
  }
  for (const [id, s] of states) await saveBase(tx, id, s);
  await journal(tx, `mc-${c.id}:settle`, due, lines);

  // Kredite, gleitendes Tageslimit der Menschen (Lieferung zählt bei Lieferung, scheitert nie am Limit).
  for (const [id, t] of traders) {
    let next = withCredits(t, credit.get(id) ?? 0);
    const human = id !== ki;
    if (human && r.qty > 0) next = { ...next, tradeHours: marketCore.addToWindow(marketCore.tradeWindow(next, due), c.resource as marketCore.ResourceId, r.qty, due) };
    if (credit.has(id) || (human && r.qty > 0)) await saveTrader(tx, id, next);
  }
  const status = r.full ? "erfuellt" : r.qty > 0 ? "teilweise" : "geplatzt";
  await tx.update(tables.marketContract).set({
    status, deliveredQty: r.qty, buyerPenaltyCents: r.buyerPenaltyCents, sellerPenaltyCents: r.sellerPenaltyCents, deliveryId, closedAt: new Date(due),
  }).where(eq(tables.marketContract.id, c.id));

  // Konvoi (KI-Hafen bzw. Verkäuferhafen → Käuferhafen): abfangbar; Geleit des Käufers läuft aus, wenn möglich.
  let escortNote = "";
  if (deliveryId && sellerBase && buyerBase) {
    const convoyId = await createConvoy(tx, {
      kind: "vertrag", deliveryId, senderId: c.sellerId, recipientId: c.buyerId!, recipientBaseId: buyerBase.id,
      from: sellerBase, to: buyerBase, cargo: { [c.resource]: r.qty }, departMs: due, arriveMs,
    });
    const escort = (c.escort as Counts | null) ?? {};
    if (buyerHuman && Object.values(escort).some((n) => n > 0)) {
      try {
        const fresh = (await lockBases(tx, [buyerBase.id])).get(buyerBase.id)!;
        await tx.transaction((inner) => attachTradeEscort(inner, c.buyerId!, fresh, escort, convoyId, sellerBase, arriveMs, due));
        escortNote = " Dein Geleit läuft der Ware entgegen.";
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
        escortNote = " Dein Geleit konnte nicht auslaufen; die Ware fährt ohne Geleit.";
      }
    }
  }

  // Erfolge und Tagesbefehle „Handel“ (ab 500 Kredite), PvP-Verbindung bei Spielerverträgen, Nachrichten.
  if (r.qty > 0 && c.counts) {
    if (buyerHuman && r.buyerPaysCents >= 50_000) await trackProgress(tx, c.buyerId!, "handel", r.buyerPaysCents / 100, { atMs: due });
    if (sellerHuman && r.sellerGetsCents >= 50_000) await trackProgress(tx, c.sellerId!, "handel", r.sellerGetsCents / 100, { atMs: due });
  }
  if (r.qty > 0 && c.kind === "spieler" && c.buyerId !== null && c.sellerId !== null) await recordTies(tx, [c.sellerId], [c.buyerId], due);
  const verdict = status === "erfuellt" ? "erfüllt" : status === "teilweise" ? `teilweise erfüllt (${fmtInt(r.qty)} von ${fmtInt(c.qty)})` : "geplatzt (nichts geliefert)";
  for (const [id, role] of [[c.buyerId, "buyer"], [c.sellerId, "seller"]] as const) {
    if (id === null || id === ki) continue;
    const parts = [`Liefervertrag über ${contractTitle(c)}: ${verdict}.`];
    if (role === "buyer" && r.qty > 0) parts.push(deliveryId ? `Die Ware ist per Konvoi unterwegs (Ankunft ${new Date(arriveMs).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}).${escortNote}` : "Die Ware liegt im Lager.");
    if (role === "buyer") parts.push(`Bezahlt: ${credText(r.buyerPaysCents)} Kredite.`);
    if (role === "seller") parts.push(`Erlös: ${credText(r.sellerGetsCents)} Kredite.`);
    const own = role === "buyer" ? r.buyerPenaltyCents : r.sellerPenaltyCents;
    if (own > 0) parts.push(`Verfallen: ${credText(own)} Kredite (${Math.round(cfg.penaltyShare * 100)} % des nicht erfüllten Werts).`);
    await systemMessage(tx, notify, [id], `Liefervertrag ${status === "erfuellt" ? "erfüllt" : status === "teilweise" ? "teilweise erfüllt" : "geplatzt"}`, parts.join(" "));
    jobs.push(push(id, `Liefervertrag ${verdict}`, parts[0], c.id));
    notify.push([[id], "base"], [[id], "market"]);
  }
  if (deliveryId) notify.push([null, "map"]);
}

/** Saisonende: offene Verträge werden rückabgewickelt; die Treuhand wird gegen season:<n> ausgebucht (wie Angebote). */
export async function voidContracts(tx: Tx, seasonNumber: number, atMs: number): Promise<void> {
  const open = await tx.execute<{ account: string; asset: string; sum: string }>(sql`
    select account, asset, sum(amount)::text as sum from trade_ledger where account like 'escrow:mc-%'
    group by account, asset having sum(amount) <> 0`);
  const rows = [...open].flatMap((o) => {
    const amount = Number(o.sum);
    const tradeId = `season-${seasonNumber}-close:${o.account}`;
    return [
      { tradeId, tMs: atMs, account: o.account, asset: o.asset, amount: (-amount).toFixed(2) },
      { tradeId, tMs: atMs, account: `season:${seasonNumber}`, asset: o.asset, amount: amount.toFixed(2) },
    ];
  });
  for (let i = 0; i < rows.length; i += 500) await tx.insert(tables.tradeLedger).values(rows.slice(i, i + 500));
  await tx.update(tables.marketContract).set({ status: "rueckabgewickelt", closedAt: new Date(atMs) })
    .where(inArray(tables.marketContract.status, ["angeboten", "offen", "nachfrist"]));
}
