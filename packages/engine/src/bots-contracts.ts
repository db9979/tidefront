// KI-Spieler und Lieferverträge (v1.31): KI-Verträge bedient die KI ohne eigenen Zug (Kontingente aus dem Lager,
// Abwicklung als Ereignis). Im Zug nutzt der Händler zusätzlich öffentliche Vertragsangebote von Spielern, die für ihn
// deutlich günstig sind – wie faire Angebote im Spielerhandel (offersTurn). Höchstens ein Vertrag je Zug.
import { and, eq, gt, isNull } from "drizzle-orm";
import { storageCapacity, market as marketCore, type BaseState, type Modifiers } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { balance } from "./context.ts";
import { fmtInt, nameOf } from "./names.ts";
import { acceptPlayerContract } from "./contracts-player.ts";
import { contractsCfg, priceInputs } from "./contracts-core.ts";
import type { TurnCtx } from "./bots-war.ts";
import type { BaseRow } from "./store.ts";

/** Mindestvorteil gegenüber dem Kurs, ab dem der Händler ein Spielerangebot annimmt. */
const EDGE = 0.03;

export async function contractsTurn(c: TurnCtx, base: BaseRow & { state: BaseState }, mods: Modifiers): Promise<void> {
  const cfg = contractsCfg();
  if (!cfg || !c.cfg.trade) return;
  const t = tables.marketContract;
  const open = await c.engine.db.select().from(t)
    .where(and(eq(t.status, "angeboten"), eq(t.kind, "spieler"), isNull(t.targetId), gt(t.offerUntil, new Date(c.nowMs))))
    .orderBy(t.id).limit(20);
  if (open.length === 0) return;
  const cap = storageCapacity(base.state, balance, mods);
  const [p] = await c.engine.db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, c.bot.id));
  const credits = (p?.trader as { credits?: number } | undefined)?.credits ?? 0;
  for (const o of open) {
    if (o.proposerId === c.bot.id) continue;
    const stock = base.state.resources[o.resource] ?? 0;
    const k = (await priceInputs(c.engine.db, o.resource as marketCore.ResourceId, c.nowMs)).k;
    // Der Spieler kauft: der Händler liefert, wenn er genug hat (über der Verkaufsschwelle) und der Preis gut ist.
    const kiSells = o.sellerId === null;
    const good = kiSells
      ? stock / cap >= cfg.ki.sellFromFill && stock >= 2 * o.qty && o.sellerUnit >= k * (1 + EDGE)
      : (stock + o.qty) / cap <= cfg.ki.buyToFill && o.buyerUnit <= k * (1 - EDGE) && credits >= o.qty * o.buyerUnit * 1.5;
    if (!good) continue;
    const r = await acceptPlayerContract(c.engine, c.bot.id, c.key("contract"), o.id, { baseId: base.id });
    if (r.ok) {
      c.log.push(`Vertrag: ${kiSells ? "liefert" : "kauft"} ${fmtInt(o.qty)} ${nameOf(o.resource)} (Angebot eines Spielers angenommen).`);
      return;
    }
  }
}
