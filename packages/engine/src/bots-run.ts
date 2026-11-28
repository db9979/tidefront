// KI-Spieler: ein Zug eines Bots und der Takt im Worker (Bots reihum, Last begrenzt).
// Ein Zug liest nur den eigenen Zustand und öffentliche Daten und handelt ausschließlich über Befehle.
import { performance } from "node:perf_hooks";
import { breakthroughPending, combineModifiers, mulberry32, settle, startTraining, startUpgrade, type BaseState, type Modifiers } from "@tidefront/game-core";
import { balance, type Engine } from "./context.ts";
import { train, upgrade } from "./commands.ts";
import { processDueForBase } from "./events.ts";
import { basesOfPlayer } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { fmtInt, nameOf } from "./names.ts";
import { researchChoose, researchStart } from "./research.ts";
import {
  appendLog, botsConfig, botsEnabled, ensureHome, loadBot, loadBots, nextTurnAt, removeBotStep, saveBotState, type BotRow,
} from "./bots-core.ts";
import { buildingsValue, chooseBuild, chooseResearch, chooseTraining, militaryTarget, militaryValue, type PlanCtx } from "./bots-plan.ts";
import { layMines, raidNest, raidPlayer, type TurnCtx } from "./bots-war.ts";
import { botPatrol, botSatellite } from "./bots-intel.ts";
import { expansionTurn, marketTurn, offersTurn } from "./bots-econ.ts";
import { fieldTurn, wantsField } from "./bots-fields.ts";
import { raidFinale } from "./bots-finale.ts";
import { admiralTurn } from "./bots-admiral.ts"; // Admirale
import { dailyTurn } from "./bots-daily.ts";
import { raidWorldEvent } from "./bots-world-events.ts";
import { retaliate } from "./bots-vergeltung.ts";
import { nest6Bundle, nest6Deficit, nest6DoctrineBoost, nest6FreeCommandPoints, nest6FuelNeed, nest6PrepActive } from "./bots-nest6.ts";

/** Zusatzanteile der Doktrin, solange ein Feldverband fehlt (bots-fields.ts). */
const FIELD_DOCTRINE = { korvette: 0.15, zerstoerer: 0.05 };
/** Rüstungsphase endet am Zielanteil; die Ausbauphase endet, wenn der Anteil unter diesen Teil des Ziels fällt. */
const MIL_RESUME = 0.75;

async function loadOwn(engine: Engine, botId: number, nowMs: number) {
  const rows = await basesOfPlayer(engine.db, botId);
  const mods = new Map<number, Modifiers>();
  const bases = [];
  for (const b of rows) {
    const m = await modsOf(engine.db, b, nowMs);
    mods.set(b.id, m);
    bases.push({ ...b, state: settle(b.state, nowMs, balance, m) as BaseState });
  }
  bases.sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.id - b.id);
  return { bases, mods };
}

/** Ein Zug: Wirtschaft je Hafen, Forschung, Handel, Felder, Gründung, Angriffe. Rückgabe: Aktionen (Logtexte). */
export async function botTurn(engine: Engine, bot: BotRow, nowMs = Date.now()): Promise<string[]> {
  const cfg = botsConfig().profiles[bot.profile];
  const rand = mulberry32((Math.imul(bot.id, 2654435761) ^ Math.floor(nowMs / 60000)) >>> 0);
  let n = 0;
  const c: TurnCtx = {
    engine, bot, cfg, nowMs, rand, log: [], state: { ...bot.state },
    key: (what) => `bot-${nowMs}-${++n}-${what}`,
  };
  const home = await ensureHome(engine, bot, nowMs);
  if (home) c.log.push(home);
  for (const b of await basesOfPlayer(engine.db, bot.id)) await processDueForBase(engine, b.id, nowMs);
  let { bases, mods } = await loadOwn(engine, bot.id, nowMs);
  if (bases.length === 0) return c.log;
  // Gründung zuerst: sie legt Rohstoffe zurück, gibt Werft und Hafenkommandantur Vorrang und hält die Werft frei.
  const expansion = await expansionTurn(c, bases, mods);
  if (c.log.length > 0) ({ bases, mods } = await loadOwn(engine, bot.id, nowMs));

  // v1.37: Rüstungsplan „Truppen für Nest 6 ab Tag 30“ (Freibeuter, Heimathafen; bots-nest6.ts).
  const prepBase = bases.find((b) => b.isHome);
  c.nest6Hold = prepBase && (await nest6PrepActive(c, prepBase)) ? prepBase.id : undefined;
  if (c.nest6Hold && prepBase && (await nest6FreeCommandPoints(c, prepBase, bases.filter((b) => !b.isHome)))) ({ bases, mods } = await loadOwn(engine, bot.id, nowMs));
  for (const b of bases) {
    const prep = c.nest6Hold === b.id;
    const plan: PlanCtx = { state: b.state, profile: bot.profile, cfg, mods: mods.get(b.id)!, nowMs, rand, ...(b.isHome ? expansion : {}), ...(prep && Object.keys(nest6Deficit(b.state)).length > 0 ? { forceMilitary: true, onlyDoctrine: nest6DoctrineBoost(b.state) } : {}) };
    if (prep) plan.reserve = { ...(plan.reserve ?? {}), treibstoff: Math.max(plan.reserve?.treibstoff ?? 0, nest6FuelNeed(b, mods.get(b.id))) }; // Treibstoff für die Fahrt
    // Bauen: bis zu buildQueue Aufträge in der Schlange (leicht 1, stark 3).
    const build = async () => {
      for (let i = 0; i < cfg.buildQueue; i++) {
        const id = chooseBuild(plan);
        if (!id) break;
        const r = await upgrade(engine, bot.id, c.key("build"), id, b.id);
        if (!r.ok) break;
        const sim = startUpgrade(plan.state, id, nowMs, balance, plan.mods);
        if (sim.ok) plan.state = sim.base;
        c.log.push(`${b.name}: Ausbau ${nameOf(id)} begonnen.`);
      }
    };
    // Ausbilden nach Doktrin (Kolonieschiff steuert expansionTurn).
    const drill = async () => {
      // Fehlen Schiffe für ein Rohstofffeld, bekommt die Doktrin einen Zusatzanteil Kriegsschiffe.
      const t = chooseTraining(plan, !prep && wantsField(c) && c.state.fieldTarget?.baseId === b.id ? FIELD_DOCTRINE : {});
      for (const o of t.orders) {
        const r = await train(engine, bot.id, c.key("train"), o.id, o.count, b.id);
        if (!r.ok) {
          c.log.push(`${b.name}: Ausbildung ${nameOf(o.id)} abgelehnt (${r.code}).`);
          continue;
        }
        const sim = startTraining(plan.state, o.id, o.count, nowMs, balance, plan.mods);
        if (sim.ok) plan.state = sim.base;
        c.log.push(`${b.name}: ${fmtInt(o.count)} × ${nameOf(o.id)} in Ausbildung.`);
      }
      return t.saving;
    };
    // Phasen je Hafen (Hysterese): Rüstung zuerst, bis sie ihren Zielanteil erreicht; dann Ausbau zuerst, bis der Anteil
    // unter MIL_RESUME des Ziels fällt. In der Ausbauphase legt chooseBuild die Kosten des nächsten Ausbaus zurück, und
    // die Ausbildung nimmt nur den Rest. Früher wechselte der Bot jeden Zug: der Anteil lag knapp unter dem Ziel, jede
    // Runde kaufte ein paar Einheiten mit dem knappen Stahl, und für Kommandozentrale oder Lager reichte es nie.
    const mil = militaryValue(plan.state);
    const share = mil / Math.max(1, mil + buildingsValue(plan.state));
    const target = militaryTarget(cfg, plan.state);
    const phases = { ...(c.state.phase ?? {}) };
    let phase = phases[b.id] ?? "mil";
    if (phase === "mil" && share >= target) phase = "build";
    else if (phase === "build" && share < MIL_RESUME * target) phase = "mil";
    c.state.phase = { ...phases, [b.id]: phase };
    if (plan.forceMilitary) {
      // v1.37: Rüstungsplan Nest 6 – solange dem Paket etwas fehlt, gehen die Rohstoffe in die Ausbildung (kein Ausbau).
      await drill();
    } else if (phase === "mil") {
      // Fehlt Geld für die dringendste Einheit, wird dafür gespart (kein Ausbau in diesem Zug).
      if (!(await drill())) await build();
    } else {
      plan.reserveWhenBusy = true;
      await build();
      await drill();
    }
    // Forschung läuft im Heimathafen.
    if (b.isHome) {
      if (breakthroughPending(plan.state)) {
        const r = await researchChoose(engine, bot.id, c.key("choose"), "level");
        if (r.ok) c.log.push("Forschungsdurchbruch: Zusatzstufe gewählt.");
      }
      const tech = chooseResearch(plan);
      if (tech) {
        const r = await researchStart(engine, bot.id, c.key("research"), tech);
        if (r.ok) c.log.push(`Forschung ${nameOf(tech)} begonnen.`);
      }
    }
  }

  ({ bases, mods } = await loadOwn(engine, bot.id, nowMs));
  const homeBase = bases.find((b) => b.isHome) ?? bases[0];
  await admiralTurn(c, homeBase); // Admirale: Freibeuter Landungstrupp, Festung Verteidigung daheim
  // Börse (Welle 2): jeder Hafen mit Börse verkauft Überschuss und kauft Knappes (Tageslimit gilt spielerweit).
  for (const b of bases) await marketTurn(c, b, mods.get(b.id)!);
  await offersTurn(c, homeBase, mods.get(homeBase.id)!);
  await dailyTurn(c); // Welle 2: Tagesbefehle und Wochenziele an etwa 60 % der Tage abholen

  // Felder und Angriffe: je Hafen höchstens ein Auslaufen dieser Art.
  ({ bases, mods } = await loadOwn(engine, bot.id, nowMs));
  for (const b of bases) {
    const m = mods.get(b.id)!;
    await botSatellite(c, b); // Lagebild Stufe 3: Satellit, wenn viele Nester ohne Lagebild sind
    if (await nest6Bundle(c, b, m)) continue; // ab Tag 35: Verband für Nest 6 bündeln (Freibeuter, Heimathafen)
    if (c.nest6Hold !== b.id && (await fieldTurn(c, b, m))) continue; // v1.37: im Rüstungsplan keine neuen Feldbesatzungen
    if (await raidFinale(c, b, m)) continue; // Saisonfinale: Abschnitt der Armada, wenn sicher gewonnen
    if (await raidWorldEvent(c, b, m)) continue; // Welle 2: Schatzschiff, Großflotte, Belagerung nach Probekampf
    if (await layMines(c, b)) continue;
    // Admirale: der Probekampf rechnet den bereiten Admiral dieses Hafens ein; tryLaunch nimmt ihn mit.
    const raid = c.admiral?.baseId === b.id ? combineModifiers(m, c.admiral.mods) : m;
    if (await retaliate(c, b, raid)) continue; // v1.35: Vergeltung gegen einen menschlichen Angreifer (Verwaltung „Vergeltung“)
    if (await raidPlayer(c, b, raid)) continue;
    if (await raidNest(c, b, raid)) continue;
    // Lagebild Stufe 2: Patrouille erst, wenn kein Angriff möglich war (früher davor: sie nahm Korvetten und einen
    // Auftragsplatz, und der Freibeuter patrouillierte statt zu überfallen).
    await botPatrol(c, b);
  }
  bot.state = c.state;
  return c.log;
}

/**
 * Worker-Takt (jede Minute): Entfernen fortsetzen, dann höchstens bots.turnsPerMinute fällige Bots reihum
 * (ältester Fälligkeitszeitpunkt zuerst) innerhalb von bots.turnBudgetMs. Fehler eines Bots werden in seinem
 * Protokoll und im Worker-Log vermerkt; der nächste Versuch kommt später.
 */
export async function runBotsDue(engine: Engine, nowMs = Date.now()): Promise<{ turns: number; ms: number[] }> {
  const out = { turns: 0, ms: [] as number[] };
  if (!(await botsEnabled(engine.db))) return out;
  const cfg = botsConfig();
  const bots = await loadBots(engine.db);
  for (const b of bots.filter((x) => x.settings.removing)) {
    await removeBotStep(engine, b.id, nowMs).catch((err) => engine.log("bot remove failed", { bot: b.id, err: String(err) }));
  }
  const due = bots
    .filter((b) => b.settings.active && !b.settings.removing && (b.state.nextActAt ?? 0) <= nowMs)
    .sort((a, b) => (a.state.nextActAt ?? 0) - (b.state.nextActAt ?? 0));
  const started = performance.now();
  for (const b of due.slice(0, cfg.turnsPerMinute)) {
    if (performance.now() - started > cfg.turnBudgetMs) break;
    const ms = await runOneBot(engine, b, nowMs);
    out.turns++;
    out.ms.push(ms);
  }
  return out;
}

/** Einen Bot ziehen lassen und seinen Zustand speichern (auch bei Fehlern). Rückgabe: Dauer in ms. */
export async function runOneBot(engine: Engine, bot: BotRow, nowMs = Date.now()): Promise<number> {
  const t0 = performance.now();
  const rand = mulberry32((bot.id * 97 + Math.floor(nowMs / 1000)) >>> 0);
  let state = bot.state;
  try {
    const actions = await botTurn(engine, bot, nowMs);
    state = appendLog(bot.state, nowMs, actions);
    state.errors = 0;
    state.nextActAt = nextTurnAt(bot.profile, bot.id, nowMs, rand);
  } catch (err) {
    engine.log("bot turn failed", { bot: bot.id, name: bot.name, err: String(err) });
    const errors = (state.errors ?? 0) + 1;
    state = appendLog(state, nowMs, [`Fehler im Zug: ${String((err as Error)?.message ?? err).slice(0, 200)}`]);
    state.errors = errors;
    state.nextActAt = nowMs + Math.min(60, 10 * errors) * 60000;
  }
  const ms = Math.round(performance.now() - t0);
  state.lastTurnAtMs = nowMs;
  state.lastTurnMs = ms;
  // Neu laden: die Verwaltung kann Einstellungen geändert haben; nur der Zustand wird geschrieben.
  if (await loadBot(engine.db, bot.id)) await saveBotState(engine.db, bot.id, state);
  return ms;
}
