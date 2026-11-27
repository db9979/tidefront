// KI-Spieler: ein Zug eines Bots und der Takt im Worker (Bots reihum, Last begrenzt).
// Ein Zug liest nur den eigenen Zustand und öffentliche Daten und handelt ausschließlich über Befehle.
import { performance } from "node:perf_hooks";
import { breakthroughPending, mulberry32, settle, startTraining, startUpgrade, type BaseState, type Modifiers } from "@tidefront/game-core";
import { balance, type Engine } from "./context.ts";
import { train, upgrade } from "./commands.ts";
import { processDueForBase } from "./events.ts";
import { basesOfPlayer } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { researchChoose, researchStart } from "./research.ts";
import {
  appendLog, botsConfig, botsEnabled, ensureHome, loadBot, loadBots, nextTurnAt, removeBotStep, saveBotState, type BotRow,
} from "./bots-core.ts";
import { buildingsValue, chooseBuild, chooseResearch, chooseTraining, militaryTarget, militaryValue, type PlanCtx } from "./bots-plan.ts";
import { layMines, raidNest, raidPlayer, type TurnCtx } from "./bots-war.ts";
import { expansionTurn, fieldTurn, marketTurn, offersTurn } from "./bots-econ.ts";

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

  for (const b of bases) {
    const plan: PlanCtx = { state: b.state, profile: bot.profile, cfg, mods: mods.get(b.id)!, nowMs, rand };
    // Bauen: bis zu buildQueue Aufträge in der Schlange (leicht 1, stark 3).
    const build = async () => {
      for (let i = 0; i < cfg.buildQueue; i++) {
        const id = chooseBuild(plan);
        if (!id) break;
        const r = await upgrade(engine, bot.id, c.key("build"), id, b.id);
        if (!r.ok) break;
        const sim = startUpgrade(plan.state, id, nowMs, balance, plan.mods);
        if (sim.ok) plan.state = sim.base;
        c.log.push(`${b.name}: Ausbau ${id} begonnen.`);
      }
    };
    // Ausbilden nach Doktrin (Kolonieschiff steuert expansionTurn).
    const drill = async () => {
      const t = chooseTraining(plan);
      for (const o of t.orders) {
        const r = await train(engine, bot.id, c.key("train"), o.id, o.count, b.id);
        if (!r.ok) {
          c.log.push(`${b.name}: Ausbildung ${o.id} abgelehnt (${r.code}).`);
          continue;
        }
        const sim = startTraining(plan.state, o.id, o.count, nowMs, balance, plan.mods);
        if (sim.ok) plan.state = sim.base;
        c.log.push(`${b.name}: ${o.count} × ${o.id} in Ausbildung.`);
      }
      return t.saving;
    };
    // Wie im Simulations-Bot: liegt die Rüstung unter ihrem Anteil, kommt sie zuerst an die Reihe.
    const mil = militaryValue(plan.state);
    if (mil < militaryTarget(cfg, plan.state) * (mil + buildingsValue(plan.state))) {
      // Fehlt Geld für die dringendste Einheit, wird dafür gespart (kein Ausbau in diesem Zug).
      if (!(await drill())) await build();
    } else {
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
        if (r.ok) c.log.push(`Forschung ${tech} begonnen.`);
      }
    }
  }

  ({ bases, mods } = await loadOwn(engine, bot.id, nowMs));
  const homeBase = bases.find((b) => b.isHome) ?? bases[0];
  await marketTurn(c, homeBase, mods.get(homeBase.id)!);
  await offersTurn(c, homeBase, mods.get(homeBase.id)!);
  await expansionTurn(c, bases, mods);

  // Felder und Angriffe: je Hafen höchstens ein Auslaufen dieser Art.
  ({ bases, mods } = await loadOwn(engine, bot.id, nowMs));
  for (const b of bases) {
    const m = mods.get(b.id)!;
    if (await fieldTurn(c, b, m)) continue;
    if (await layMines(c, b)) continue;
    if (await raidPlayer(c, b, m)) continue;
    await raidNest(c, b, m);
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
