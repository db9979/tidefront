// KI-Spieler im Saisonfinale: Freibeuter und Festung greifen einen Abschnitt der Kartell-Armada an, sobald der Probekampf
// gegen den eigenen Abschnitt (deterministisch, feste Seeds) mit allen Läufen gewinnt; höchstens alle botIntervalHours je
// Bot, ein Missionsplatz bleibt frei. Händler nehmen nicht teil. Verband: Kriegsschiffe und Flugzeuge ohne Heimwache.
import { and, eq, gt, inArray } from "drizzle-orm";
import {
  activeUnits,
  finaleBalance,
  finaleProbe,
  finaleSector,
  finaleWarHp,
  finaleWarUnits,
  missionSlots,
  type BaseState,
  type Counts,
  type Modifiers,
} from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { balance } from "./context.ts";
import { launchMission } from "./commands.ts";
import { missionPreview } from "./views.ts";
import { activeMissionCount, type BaseRow } from "./store.ts";
import { reservedForField } from "./bots-fields.ts";
import { strikeForce, withoutReserve, type TurnCtx } from "./bots-war.ts";
import { finaleAim } from "./finale-battle.ts";
import type { WorldEventRow } from "./world-events.ts";

const HOUR_MS = 3600000;

/** Ein Angriff auf die Armada aus diesem Hafen, wenn er sicher gewinnt. Rückgabe: ausgelaufen. */
export async function raidFinale(c: TurnCtx, base: BaseRow & { state: BaseState }, mods: Modifiers): Promise<boolean> {
  const f = finaleBalance(balance);
  if (!f || c.bot.profile === "haendler" || c.cfg.probeRuns <= 0) return false;
  const [row] = await c.engine.db.select().from(tables.worldEvent)
    .where(and(eq(tables.worldEvent.kind, "finale"), eq(tables.worldEvent.status, "active"))).limit(1);
  const ev = row as WorldEventRow | undefined;
  if (!ev || c.nowMs >= ev.endsAt.getTime()) return false;
  // Höchstens alle botIntervalHours: letzter eigener Verband gegen die Armada.
  const [recent] = await c.engine.db.select({ id: tables.mission.id }).from(tables.mission).where(and(
    eq(tables.mission.playerId, c.bot.id), eq(tables.mission.targetKind, "event"), eq(tables.mission.targetId, ev.id),
    gt(tables.mission.createdAt, new Date(c.nowMs - f.botIntervalHours * HOUR_MS)),
  )).limit(1);
  if (recent) return false;
  const [busy] = await c.engine.db.select({ id: tables.mission.id }).from(tables.mission).where(and(
    eq(tables.mission.playerId, c.bot.id), eq(tables.mission.targetKind, "event"), eq(tables.mission.targetId, ev.id), inArray(tables.mission.status, ["outbound"]),
  )).limit(1);
  if (busy) return false;
  // Ein Missionsplatz bleibt frei.
  if ((await activeMissionCount(c.engine.db, base.id)) + 1 >= missionSlots(base.state, balance)) return false;
  const force: Counts = finaleWarUnits(withoutReserve(strikeForce(base.state, c.cfg.homeGuardShare), reservedForField(c, base.id)), balance);
  const k = finaleWarHp(force, balance);
  if (k <= 0) return false;
  const sector = finaleSector(activeUnits(ev.units as Counts), k, balance);
  const point = finaleAim(ev, base);
  if (Object.keys(sector.defender).length === 0 || (sector.flagship && (point.col !== ev.col || point.row !== ev.row))) return false;
  const p = finaleProbe({ units: force, modifiers: mods }, sector.defender, balance, c.cfg.probeRuns);
  if (p.winRate < 1) return false;
  const input = { type: "ueberfall", units: force, col: point.col, row: point.row, eventId: ev.id, baseId: base.id };
  const pv = await missionPreview(c.engine, c.bot.id, input);
  if (!pv.ok) return false;
  const r = await launchMission(c.engine, c.bot.id, c.key("finale"), input);
  if (r.ok) c.log.push(`${base.name}: Angriff auf die Kartell-Armada (${sector.flagship ? "Flaggschiff" : `${sector.defender.schnellboot ?? 0} Schnellboote`}).`);
  return r.ok;
}
