// KI-Spieler: Admirale (Vorlage Admirale, Abschnitt 3.3). Freibeuter ernennen einen „Landungstrupp“ und nehmen ihn
// auf Überfälle mit; die Festung ernennt „Verteidigung“ und lässt ihn als Hafenkommandant daheim. Ernennung über
// denselben Befehl wie für Menschen (appointAdmiral: gleiche Kosten, Plätze und Namen), ab Hafenkommandantur 1.
import { eq } from "drizzle-orm";
import { buildingLevel, type BaseState } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { balance } from "./context.ts";
import { appointAdmiral, stationAdmiral } from "./admirals.ts";
import { activeMissions, admiralRowMods, admiralStatus } from "./admirals-core.ts";
import { fmtInt } from "./names.ts";
import type { BotProfile } from "./bots-core.ts";
import type { TurnCtx } from "./bots-war.ts";
import type { BaseRow } from "./store.ts";

/** Spezialisierung je Spielweise (der Händler ernennt keinen Admiral). */
export const BOT_ADMIRAL_SPEC: Partial<Record<BotProfile, string>> = { freibeuter: "landung", festung: "verteidigung" };

/**
 * Admiral-Zug im Heimathafen: ernennen, sobald bezahlbar (bis dahin hält der Bot die Taler an der Börse zurück:
 * c.creditReserve); Festung: Hafenkommandant sicherstellen; Freibeuter: bereiten Admiral für Überfälle in c.admiral.
 */
export async function admiralTurn(c: TurnCtx, home: BaseRow & { state: BaseState }): Promise<void> {
  const cfg = balance.admirals;
  const spec = BOT_ADMIRAL_SPEC[c.bot.profile];
  if (!cfg || !spec || !Object.hasOwn(cfg.specs, spec) || buildingLevel(home.state, "hafenkommandantur") < 1) return;
  const rows = await c.engine.db.select().from(tables.admiral).where(eq(tables.admiral.playerId, c.bot.id));
  if (rows.length === 0) {
    const [p] = await c.engine.db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, c.bot.id));
    const credits = (p?.trader as { credits?: number } | undefined)?.credits ?? 0;
    if (credits + 1e-9 < cfg.cost.credits || (home.state.resources.elektronik ?? 0) < cfg.cost.elektronik) {
      c.creditReserve = cfg.cost.credits;
      return;
    }
    const r = await appointAdmiral(c.engine, c.bot.id, c.key("admiral"), { name: null, spec, baseId: home.id });
    if (r.ok) c.log.push(`Admiral ${r.name} ernannt (${cfg.specs[spec].name}, ${fmtInt(cfg.cost.credits)} Taler).`);
    return;
  }
  const own = rows.filter((a) => a.baseId === home.id);
  if (c.bot.profile === "festung") {
    if (own.length > 0 && !own.some((a) => a.stationed)) {
      const r = await stationAdmiral(c.engine, c.bot.id, c.key("station"), { admiralId: own[0].id, baseId: home.id });
      if (r.ok) c.log.push(`Admiral ${own[0].name} ist Hafenkommandant.`);
    }
    return;
  }
  const active = await activeMissions(c.engine.db, own);
  const ready = own.find((a) => admiralStatus(a, active, c.nowMs).status === "bereit");
  if (ready) c.admiral = { id: ready.id, baseId: ready.baseId, mods: admiralRowMods(ready, "mission") };
}
