// Forschung auf dem Server: Befehle (Start, Abbruch, Wahl der Durchbruch-Belohnung), Ereignis
// research_complete (mit Durchbruch-Wurf aus dem beim Start gespeicherten Seed) und das Lesemodell.
// Der Forschungsstand liegt im BaseState (research) und wird mit dem Stützpunkt zum Saisonende gelöscht.
import {
  breakthroughChance,
  breakthroughPending,
  cancelResearch,
  chooseBreakthrough,
  completeResearch,
  researchBlocker,
  researchCost,
  researchSeconds,
  researchState,
  startResearch,
  type BaseState,
  type Modifiers,
  type ResourceMap,
} from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import type { Handler } from "./events.ts";
import { runCommand } from "./commands.ts";
import { baseOfPlayer, lockBase, randomSeed, saveBase, scheduleEvent } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { trackProgress } from "./challenges.ts";

async function ownLocked(tx: Parameters<Handler>[0], playerId: number) {
  const own = await baseOfPlayer(tx, playerId);
  const b = own ? await lockBase(tx, own.id) : null;
  if (!b) throw new GameError("no_base");
  return b;
}

/** Startet die nächste Stufe einer Technik. Codes: siehe startResearch im Kern. */
export function researchStart(engine: Engine, playerId: number, key: string, techId: string) {
  return runCommand<{ ok: true; finishesAt: number }>(engine, playerId, key, "researchStart", async (ctx) => {
    const b = await ownLocked(ctx.tx, playerId);
    const r = startResearch(b.state, techId, ctx.nowMs, balance, await modsOf(ctx.tx, b, ctx.nowMs), randomSeed());
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    await scheduleEvent(ctx.tx, "research_complete", r.order.finishesAt, {}, b.id);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, finishesAt: r.order.finishesAt };
  });
}

/** Bricht die laufende Forschung ab (Erstattung nach Restzeit). Das geplante Ereignis läuft ins Leere. */
export function researchCancel(engine: Engine, playerId: number, key: string) {
  return runCommand<{ ok: true; refund: ResourceMap }>(engine, playerId, key, "researchCancel", async (ctx) => {
    const b = await ownLocked(ctx.tx, playerId);
    const r = cancelResearch(b.state, ctx.nowMs, balance, await modsOf(ctx.tx, b, ctx.nowMs));
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, refund: r.refund };
  });
}

/** Wahl der Durchbruch-Belohnung ("level" oder "speed"); dieselbe Wahl erneut ist harmlos. */
export function researchChoose(engine: Engine, playerId: number, key: string, choice: string) {
  return runCommand<{ ok: true; choice: string }>(engine, playerId, key, "researchChoose", async (ctx) => {
    const b = await ownLocked(ctx.tx, playerId);
    const r = chooseBreakthrough(b.state, choice, ctx.nowMs, balance, await modsOf(ctx.tx, b, ctx.nowMs));
    if (!r.ok) return r;
    if (r.changed) await saveBase(ctx.tx, b.id, r.base);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, choice: r.choice };
  });
}

/** Ereignis research_complete: Stufe erhöhen, Durchbruch würfeln und speichern, bei Durchbruch Nachricht und Push. */
export const researchComplete: Handler = async (tx, ev, due) => {
  const b = await lockBase(tx, ev.baseId!);
  if (!b) return { notify: [] };
  const order = researchState(b.state).order;
  // Abgebrochen, neu gestartet oder schon erledigt: nichts zu tun.
  if (!order || order.finishesAt > due) return { notify: [] };
  // Bestände bis zur Fertigstellung mit den alten Stufen; danach gelten die neuen.
  const r = completeResearch(b.state, due, balance, await modsOf(tx, b, order.finishesAt));
  if (!r.ok) return { notify: [] };
  await saveBase(tx, b.id, r.base);
  await trackProgress(tx, b.playerId, "forschung", 1, { atMs: due });
  if (!r.roll.breakthrough) return { notify: [[[b.playerId], "base"]] };
  const name = techName(r.roll.techId);
  const wurf = String(r.roll.roll).padStart(2, "0");
  const body = r.roll.choice === "speed"
    ? `Durchbruch bei ${name} (Wurf ${wurf} bei ${Math.round(r.roll.chance * 100)} % Chance)! Die Technik ist auf Höchststufe – deine nächste Forschung dauert nur halb so lange.`
    : `Durchbruch bei ${name} (Wurf ${wurf} bei ${Math.round(r.roll.chance * 100)} % Chance)! Wähle im Forschungsamt deine Belohnung: eine Stufe mehr für ${name} oder halbe Dauer für die nächste Forschung.`;
  await tx.insert(tables.message).values({ fromPlayerId: null, toPlayerId: b.playerId, subject: `Durchbruch: ${name}`, body, createdAt: new Date(due) });
  return {
    notify: [[[b.playerId], "base"], [[b.playerId], "messages"]],
    push: [{ playerId: b.playerId, notice: { kind: "build", url: "/?tab=basis", tag: `research-${b.id}`, title: "Durchbruch in der Forschung", body } }],
  };
};

/** Anzeigename einer Technik für Nachrichten (die Oberfläche hat ihre eigenen Texte). */
export const TECH_NAMES: Record<string, string> = {
  dampfturbinen: "Dampfturbinen", schiffspanzerung: "Schiffspanzerung", sonar: "Sonar", prisenrecht: "Prisenrecht",
  torpedoleitsysteme: "Torpedoleitsysteme", infanteriewaffen: "Infanteriewaffen", drillausbildung: "Drillausbildung",
  verbundpanzerung: "Verbundpanzerung", pioniertechnik: "Pioniertechnik", festungsbau: "Festungsbau",
  funkmesstechnik: "Funkmesstechnik", strahltriebwerke: "Strahltriebwerke", luftkampftaktik: "Luftkampftaktik",
  tarnanstrich: "Tarnanstrich", praezisionsbomben: "Präzisionsbomben", hochofen: "Hochofen", logistik: "Logistik",
  lagertechnik: "Lagertechnik", fertigbau: "Fertigbau", stahlbetonbunker: "Stahlbetonbunker",
};

function techName(id: string): string {
  return TECH_NAMES[id] ?? id;
}

/** Lesemodell für baseView: Stufen, laufender Auftrag, letzter Wurf und je Technik Kosten, Dauer, Sperrgrund. */
export function researchView(state: BaseState, mods: Modifiers) {
  const r = balance.research;
  if (!r) return null;
  const rs = researchState(state);
  const lvl = state.buildings[r.building] ?? 0;
  const half = rs.halfNext === true ? (r.breakthrough?.speedFactor ?? 1) : 1;
  return {
    building: r.building,
    buildingLevel: lvl,
    levels: rs.levels,
    order: rs.order,
    lastRoll: rs.lastRoll ?? null,
    halfNext: rs.halfNext === true,
    pendingChoice: breakthroughPending(state),
    chance: breakthroughChance(state, balance),
    techs: Object.keys(r.techs).map((id) => {
      const level = rs.levels[id] ?? 0;
      const maxed = level >= r.techs[id].maxLevel;
      return {
        id,
        level,
        cost: maxed ? null : researchCost(id, level, balance),
        seconds: maxed ? null : researchSeconds(id, level, lvl, balance, mods) * half,
        blocker: researchBlocker(state, id, balance),
      };
    }),
  };
}
