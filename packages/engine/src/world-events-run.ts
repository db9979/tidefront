// Weltereignisse: Ablauf nach dem Entstehen. world_event_move (Schatzschiff: Position fortschreiben;
// Belagerung: stündlicher Produktionsabzug), world_event_attack (Großflotte greift den nächsten Hafen an),
// world_event_end (Schatzschiff entkommen, Belagerung aufgehoben). Handler-Tabelle für handlers.ts.
import { eq } from "drizzle-orm";
import {
  activeUnits,
  applyDefenseResult,
  applySiegePenalty,
  armadaAttacker,
  defenderFromBase,
  productionRates,
  raidBlocked,
  resolveBattle,
  routePosition,
  settle,
  storageCapacity,
  worldEventsBalance,
} from "@tidefront/game-core";
import { hexAtLonLat } from "@tidefront/world";
import { tables, type Tx } from "@tidefront/db";
import { balance, type NoticeJob } from "./context.ts";
import type { Handler, HandlerResult } from "./events.ts";
import { lockBase, randomSeed, saveBase, scheduleEvent } from "./store.ts";
import {
  addRes, contributors, endWorldEvent, isOpen, lockWorldEvent, notice, playersWithBase, resText, sumRes, systemMessage,
  type WorldEventRow,
} from "./world-events.ts";
import { worldEventSpawn } from "./world-events-spawn.ts";

const HOUR_MS = 3600000;
const none = (): HandlerResult => ({ notify: [] });

/** Belagerung: Abzug von productionPenalty der Gebäudeproduktion seit dem letzten Abzug bis `untilMs`. */
async function siegeTick(tx: Tx, ev: WorldEventRow, untilMs: number): Promise<number[]> {
  const from = ev.data.lastTickMs ?? ev.startsAt.getTime();
  const to = Math.min(untilMs, ev.endsAt.getTime());
  if (to <= from || ev.targetBaseId === null) return [];
  const b = await lockBase(tx, ev.targetBaseId);
  if (!b) return [];
  const state = settle(b.state, to, balance);
  const r = applySiegePenalty(state.resources, productionRates(state, balance).buildingPerHour, storageCapacity(state, balance), (to - from) / HOUR_MS, balance);
  state.resources = r.resources;
  await saveBase(tx, b.id, state);
  const data = { ...ev.data, lastTickMs: to, deducted: addRes(ev.data.deducted ?? {}, r.deducted) };
  await tx.update(tables.worldEvent).set({ data }).where(eq(tables.worldEvent.id, ev.id));
  ev.data = data;
  return [b.playerId];
}

const worldEventMove: Handler = async (tx, ev, due) => {
  const e = await lockWorldEvent(tx, Number(ev.payload.eventId));
  if (!e || !isOpen(e)) return none();
  const end = e.endsAt.getTime();
  if (e.kind === "schatzschiff" && e.data.route) {
    const p = routePosition(e.data.route, due);
    const h = hexAtLonLat(p.lon, p.lat);
    await tx.update(tables.worldEvent).set({ col: h.col, row: h.row }).where(eq(tables.worldEvent.id, e.id));
    if (due + HOUR_MS < end) await scheduleEvent(tx, "world_event_move", due + HOUR_MS, { eventId: e.id }, null);
    return { notify: [[null, "map"]] };
  }
  if (e.kind === "belagerung") {
    const owner = await siegeTick(tx, e, due);
    const step = worldEventsBalance(balance).belagerung.tickMinutes * 60000;
    if (due + step < end) await scheduleEvent(tx, "world_event_move", due + step, { eventId: e.id }, e.targetBaseId);
    return { notify: owner.map((id) => [[id], "base"] as [number[], "base"]) };
  }
  return none();
};

/** Großflotte greift den nächsten Hafen an; Schutz (Nachtschild, Anfängerschutz, Niederlage) lässt sie vorbeiziehen. */
const worldEventAttack: Handler = async (tx, ev, due) => {
  const e = await lockWorldEvent(tx, Number(ev.payload.eventId));
  if (!e || !isOpen(e) || e.kind !== "grossflotte") return none();
  const g = worldEventsBalance(balance).grossflotte;
  const targets = [...(e.data.targets ?? [])];
  const index = e.data.next ?? 0;
  const notify: HandlerResult["notify"] = [[null, "map"]];
  const push: NoticeJob[] = [];
  let units = activeUnits(e.units);
  let pool = e.data.lootPool ?? {};
  let pos = { col: e.col, row: e.row };
  const target = targets[index];
  if (target) {
    const b = await lockBase(tx, target.baseId);
    if (!b) {
      targets[index] = { ...target, status: "gone" };
    } else if (raidBlocked(b.state.protection, due, balance).blocked) {
      targets[index] = { ...target, status: "skipped" };
      await systemMessage(tx, [b.playerId], "Großflotte zieht vorbei", `Die Großflotte des Kartells zieht an ${b.name} vorbei – dein Hafen steht unter Schutz.`, due);
      notify.push([[b.playerId], "messages"]);
    } else {
      const state = settle(b.state, due, balance);
      const attacker = armadaAttacker(units, balance);
      const seed = randomSeed();
      const res = resolveBattle(attacker, defenderFromBase(state, balance), balance, seed);
      if (!res.ok) throw new Error(`battle: ${res.code}`);
      const report = res.report;
      await saveBase(tx, b.id, applyDefenseResult(state, report, due, balance));
      if ((report.wreck.stahl ?? 0) + (report.wreck.elektronik ?? 0) > 0) {
        await tx.insert(tables.wreck).values({ col: b.col, row: b.row, stahl: report.wreck.stahl ?? 0, elektronik: report.wreck.elektronik ?? 0, createdAt: new Date(due) });
      }
      const [p] = await tx.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, b.playerId));
      await tx.insert(tables.battleReport).values({
        kind: "weltereignis", title: `Großflotte greift ${b.name} an`, attackerPlayerId: null, defenderPlayerId: b.playerId,
        attackerBaseId: null, defenderBaseId: b.id, nestId: null, winner: report.winner, seed, balanceVersion: balance.version,
        createdAt: new Date(due),
        report: { battle: report, attackerName: "Großflotte des Kartells", defenderName: p?.name ?? "?", targetName: b.name, attacker, worldEvent: { id: e.id, kind: e.kind } },
      });
      units = activeUnits(report.attacker.final);
      pool = addRes(pool, report.loot);
      pos = { col: b.col, row: b.row };
      targets[index] = { ...target, status: "attacked", winner: report.winner };
      const won = report.winner === "defender";
      push.push(notice(b.playerId, "attack", `Großflotte greift ${b.name} an`, won ? "Dein Hafen hat die Großflotte abgewehrt." : `Die Großflotte hat ${resText(report.loot)} erbeutet.`));
      notify.push([[b.playerId], "base"], [[b.playerId], "reports"]);
    }
  }
  const next = index + 1;
  const beaten = (units.schnellboot ?? 0) <= 0;
  const done = beaten || next >= targets.length;
  const data = { ...e.data, targets, next, lootPool: pool };
  if (done) {
    await endWorldEvent(tx, e, beaten ? "defeated" : "withdrawn", due, null, { units, data, col: pos.col, row: pos.row, endsAt: new Date(due) });
    const ids = [...targets.map((t) => t.playerId), ...(await contributors(tx, e.id))];
    await systemMessage(tx, ids, "Großflotte abgezogen", beaten
      ? "Die Großflotte des Kartells ist zerschlagen."
      : `Die Großflotte des Kartells ist nach ihren Angriffen abgezogen (verbleibend: ${units.schnellboot ?? 0} Schnellboote).`, due);
    notify.push([null, "messages"]);
  } else {
    const at = due + g.attackIntervalHours * HOUR_MS;
    await tx.update(tables.worldEvent)
      .set({ status: "active", units, data, col: pos.col, row: pos.row, endsAt: new Date(at + Math.max(0, targets.length - next - 1) * g.attackIntervalHours * HOUR_MS + HOUR_MS) })
      .where(eq(tables.worldEvent.id, e.id));
    await scheduleEvent(tx, "world_event_attack", at, { eventId: e.id }, null);
  }
  return { notify, push };
};

/** Ende: Schatzschiff erreicht den Hafen, Belagerung läuft aus (letzter Abzug). */
const worldEventEnd: Handler = async (tx, ev, due) => {
  const e = await lockWorldEvent(tx, Number(ev.payload.eventId));
  if (!e || !isOpen(e)) return none();
  const notify: HandlerResult["notify"] = [[null, "map"], [null, "messages"]];
  if (e.kind === "schatzschiff") {
    await endWorldEvent(tx, e, "escaped", due, null, { col: e.data.harbor?.col ?? e.col, row: e.data.harbor?.row ?? e.row });
    const ids = (await playersWithBase(tx)).map((p) => p.playerId);
    await systemMessage(tx, ids, "Schatzschiff entkommen", `Das Schatzschiff hat den Kartellhafen erreicht. ${resText(e.data.loot ?? {})} sind verloren.`, due);
  } else if (e.kind === "belagerung") {
    const owner = await siegeTick(tx, e, due);
    await endWorldEvent(tx, e, "expired", due);
    const lost = sumRes(e.data.deducted);
    await systemMessage(tx, [...owner, ...(await contributors(tx, e.id))], `Belagerung von ${e.data.baseName ?? "?"} beendet`,
      `Der Belagerungsring ist abgezogen. Produktionsverlust während der Belagerung: ${Math.floor(lost).toLocaleString("de-DE")} Ressourcen.`, due);
    for (const id of owner) notify.push([[id], "base"]);
  } else {
    await endWorldEvent(tx, e, "withdrawn", due);
  }
  return { notify };
};

export const WORLD_EVENT_HANDLERS: Record<string, Handler> = {
  world_event_spawn: worldEventSpawn,
  world_event_move: worldEventMove,
  world_event_attack: worldEventAttack,
  world_event_end: worldEventEnd,
};

export { siegeTick };
