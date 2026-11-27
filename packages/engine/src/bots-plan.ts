// KI-Spieler: reine Entscheidungen auf einem Hafenzustand (Bauen, Ausbilden, Forschen). Keine Datenbank;
// geprüft wird mit denselben Kernfunktionen wie in den Befehlen (startUpgrade, startTraining, startResearch),
// ausgeführt wird danach über die Befehle (bots-run.ts). Ideen aus game-core/sim/bot.ts (Bauordnung, Doktrin).
import {
  commandPoints,
  fleetTotals,
  maxAllowedLevel,
  missingRequirement,
  plannedLevel,
  productionRates,
  researchCost,
  satelliteOf,
  startResearch,
  startTraining,
  startUpgrade,
  storageCapacity,
  trainingCost,
  upgradeCost,
  type BaseState,
  type Counts,
  type Modifiers,
  type ResourceMap,
} from "@tidefront/game-core";
import { balance } from "./context.ts";
import type { BotProfile, ProfileConfig } from "./bots-core.ts";

export interface PlanCtx {
  state: BaseState;
  profile: BotProfile;
  cfg: ProfileConfig;
  mods: Modifiers;
  nowMs: number;
  rand: () => number;
  /** Rücklage: diese Rohstoffe bleiben für den nächsten Ausbau bzw. das Kolonieschiff liegen (Ausbildung nimmt sie nicht). */
  reserve?: ResourceMap;
  /** Gebäude, deren Ausbau gerade Vorrang hat (z. B. Werft und Hafenkommandantur für das Kolonieschiff). */
  boost?: string[];
  /** Auch bei voller Bauschlange die Kosten des nächsten Ausbaus zurücklegen (Ausbauphase, bots-run.ts). */
  reserveWhenBusy?: boolean;
  /** Diese Baugebäude bleiben für einen besonderen Auftrag frei (Werft für das Kolonieschiff). */
  keepFree?: string[];
}

/** Strom gilt erst unter diesem Anteil als knapp: das Kraftwerk regelt nach (0.21.3), der Faktor liegt oft bei 0,99999…. */
const POWER_SHORT = 0.995;

/** Gewichte der Bauordnung je Spielweise (höher = früher, gemessen an den Kosten der nächsten Stufe). */
const BUILD_WEIGHTS: Record<BotProfile, Record<string, number>> = {
  haendler: {
    stahlwerk: 3, raffinerie: 2.2, chipfabrik: 2, versorgungshof: 2, lagerkomplex: 2, kommandozentrale: 1.6, hafenkommandantur: 2.6,
    tiefbunker: 1.4, kaserne: 0.4, werft: 0.8, radarstation: 0.5, speicherwerk: 0.4, forschungsamt: 0.5,
  },
  festung: {
    stahlwerk: 2.4, raffinerie: 1.8, chipfabrik: 1.8, versorgungshof: 1.6, lagerkomplex: 1.3, kommandozentrale: 1.6, tiefbunker: 1.8,
    radarstation: 1.8, forschungsamt: 1.8, kaserne: 1, werft: 1.1, flugfeld: 0.9, hafenkommandantur: 1.1, nachrichtendienst: 0.4,
  },
  freibeuter: {
    stahlwerk: 2.4, raffinerie: 2, chipfabrik: 1.8, versorgungshof: 1.6, lagerkomplex: 1, kommandozentrale: 1.6, werft: 2.4, kaserne: 1.4,
    flugfeld: 1.4, hafenkommandantur: 2, nachrichtendienst: 0.6, radarstation: 0.4, tiefbunker: 0.3, forschungsamt: 0.5,
  },
};

/**
 * Ökostrom (v1.21), nur der Händler: Windpark im Norden, Solarfeld im Süden, Elektrolyse erst bei genug Wind- und
 * Sonnenstufen (sie nimmt nur Überschuss auf). Kraftwerk bleibt die Antwort auf akuten Strommangel.
 */
function greenWeights(s: BaseState): Record<string, number> {
  const lat = s.site?.lat ?? 50;
  const renew = (s.buildings.windpark ?? 0) + (s.buildings.solarfeld ?? 0);
  const out: Record<string, number> = { windpark: lat >= 47 ? 1.1 : 0.4, solarfeld: lat < 47 ? 1.1 : 0.4 };
  if (renew >= 3 && (s.buildings.elektrolyse ?? 0) < Math.floor(renew / 2)) out.elektrolyse = 1.2;
  return out;
}

/**
 * Lagebild Stufe 3: Startrampe (Stufe 1 genügt) für Freibeuter und Festung, sobald die Voraussetzungen stehen;
 * Störsender (bis Stufe 2, dann ist die Wirkung voll) für die Festung ab Radarstation 5.
 */
function spaceWeights(s: BaseState, profile: BotProfile): Record<string, number> {
  const out: Record<string, number> = {};
  if (profile === "haendler") return out;
  if (balance.buildings.startrampe && (s.buildings.startrampe ?? 0) < 1 && !missingRequirement(s, "startrampe", balance)) out.startrampe = profile === "freibeuter" ? 1.5 : 0.8;
  // Voraussetzungen der Startrampe (aus der Balance) gezielt nachziehen, sobald die Kommandozentrale fast reicht.
  const req = balance.buildings.startrampe?.requires ?? {};
  if (balance.buildings.startrampe && (s.buildings.startrampe ?? 0) < 1 && (s.buildings.kommandozentrale ?? 0) >= (req.kommandozentrale ?? 0) - 2) {
    for (const [id, lvl] of Object.entries(req)) if (id !== "kommandozentrale" && plannedLevel(s, id) < lvl) out[id] = 2;
  }
  if (profile === "festung" && balance.buildings.stoersender && (s.buildings.stoersender ?? 0) < 2 && !missingRequirement(s, "stoersender", balance)) out.stoersender = 0.6;
  return out;
}

/** Erzeuger je Ressource (Knappheit in der Bauordnung). */
const PRODUCERS: Record<string, string> = { stahlwerk: "stahl", raffinerie: "treibstoff", chipfabrik: "elektronik", versorgungshof: "proviant" };

/** Doktrin: Zielanteile am Rüstungswert (Einheiten und Anlagen). Landungsschiffe folgen dem Truppenbedarf. */
const DOCTRINES: Record<BotProfile, Record<string, number>> = {
  haendler: { kuestenbatterie: 0.3, flakstellung: 0.15, bunkerlinie: 0.15, korvette: 0.25, schuetzen: 0.15 },
  festung: {
    kuestenbatterie: 0.18, flakstellung: 0.12, bunkerlinie: 0.12, korvette: 0.14, zerstoerer: 0.1, schuetzen: 0.12, pioniere: 0.04,
    jagdbomber: 0.1, abfangjaeger: 0.08,
  },
  freibeuter: {
    korvette: 0.25, zerstoerer: 0.08, uboot: 0.1, schuetzen: 0.25, pioniere: 0.08, kampfpanzer: 0.05, jagdbomber: 0.12,
    aufklaerungsdrohne: 0.02, minenleger: 0.03, kuestenbatterie: 0.02,
  },
};

/** Forschungsreihenfolge je Spielweise (wiederholt, bis die Höchststufe erreicht ist). */
const RESEARCH: Record<BotProfile, string[]> = {
  haendler: ["hochofen", "lagertechnik", "logistik", "fertigbau", "stahlbetonbunker", "verschluesselung"],
  festung: [
    "infanteriewaffen", "funkmesstechnik", "schiffspanzerung", "drillausbildung", "pioniertechnik", "festungsbau", "lagertechnik",
    "stahlbetonbunker", "verbundpanzerung", "hochofen", "luftkampftaktik", "tarnnetze", "optischer_satellit",
  ],
  freibeuter: ["dampfturbinen", "schiffspanzerung", "prisenrecht", "infanteriewaffen", "sonar", "torpedoleitsysteme", "logistik", "praezisionsbomben", "optischer_satellit", "radarsatellit"],
};

/** Losgröße je Auftrag höchstens. */
const MAX_BATCH: Record<string, number> = { schuetzen: 40, pioniere: 20, aufklaerungsdrohne: 2, minenleger: 2, landungsschiff: 2 };
/** Höchstbestand einzelner Hilfseinheiten. */
const MAX_HOLD: Record<string, number> = { aufklaerungsdrohne: 3, minenleger: 4 };

export function value(cost: ResourceMap): number {
  let v = 0;
  for (const [r, n] of Object.entries(cost)) v += n * (balance.market.refPrice[r] ?? 0);
  return v;
}

function unitValue(id: string): number {
  return value(trainingCost(id, 1, balance));
}

/** Kostenwert aller Gebäudestufen. */
export function buildingsValue(state: BaseState): number {
  let v = 0;
  for (const [id, lvl] of Object.entries(state.buildings)) for (let l = 0; l < lvl; l++) v += value(upgradeCost(id, l, balance));
  return v;
}

/** Bestand je Typ: daheim, unterwegs, in Ausbildung, Anlagen. */
export function holdings(state: BaseState): Counts {
  const all: Counts = { ...state.defenses };
  for (const [id, n] of Object.entries(state.units)) all[id] = (all[id] ?? 0) + n;
  for (const [id, n] of Object.entries(state.unitsAway ?? {})) all[id] = (all[id] ?? 0) + n;
  for (const o of state.trainingQueue) all[o.id] = (all[o.id] ?? 0) + o.count;
  return all;
}

export function militaryValue(state: BaseState): number {
  let v = 0;
  for (const [id, n] of Object.entries(holdings(state))) if (n > 0 && id !== "kolonieschiff") v += n * unitValue(id);
  return v;
}


/** Nächster Ausbau oder null (sparen / nichts zu tun). */
export function chooseBuild(c: PlanCtx): string | null {
  const s = c.state;
  // Schlange voll: nichts beginnen, aber (reserveWhenBusy) die Kosten des nächsten Ausbaus zurücklegen.
  const busy = s.buildQueue.length >= Math.min(c.cfg.buildQueue, balance.building.queueSlots);
  if (busy && !c.reserveWhenBusy) return null;
  const weights: Record<string, number> = { ...BUILD_WEIGHTS[c.profile], ...(c.profile === "haendler" ? greenWeights(s) : {}), ...spaceWeights(s, c.profile) };
  for (const id of c.boost ?? []) weights[id] = Math.max(weights[id] ?? 1, 1.5) * 4;
  const rates = productionRates(s, balance, c.mods, c.nowMs);
  const cap = storageCapacity(s, balance, c.mods);
  if (balance.resources.some((r) => (s.resources[r] ?? 0) > 0.85 * cap)) weights.lagerkomplex = (weights.lagerkomplex ?? 1) * 3;
  // Knappheit: Erzeuger der knappen Ressource vorziehen, Erzeuger eines Überschusses zurückstellen.
  // Die leichte Spielweise plant das nicht (Entscheidungsqualität).
  const smart = c.cfg.noise < 0.3;
  const fill = (r: string) => (s.resources[r] ?? 0) / cap;
  const avg = balance.resources.reduce((a, r) => a + fill(r), 0) / balance.resources.length;
  for (const [id, r] of Object.entries(PRODUCERS)) {
    if (smart && weights[id] !== undefined) weights[id] *= Math.min(4, Math.max(0.3, avg / Math.max(0.02, fill(r))));
  }
  // Die Kommandozentrale deckelt alle anderen Gebäude: stehen mehrere am Deckel, kommt sie zuerst.
  const capped = Object.keys(weights).filter((id) => id !== "kommandozentrale" && plannedLevel(s, id) >= maxAllowedLevel(s, id, balance)).length;
  if (smart && capped >= 3) weights.kommandozentrale = (weights.kommandozentrale ?? 1) * (1 + capped);
  const open = (id: string) => !!balance.buildings[id] && plannedLevel(s, id) < maxAllowedLevel(s, id, balance);
  let candidates = Object.keys(weights).filter(open);
  const score = (id: string) => value(upgradeCost(id, plannedLevel(s, id), balance)) / (weights[id] ?? 1);
  // Strommangel: zuerst Strom (Kraftwerk, Wind/Sonne, Treibstoff für das Kraftwerk; steht das Kraftwerk am Deckel, die
  // Kommandozentrale). Früher nur „Kraftwerk“ und schon bei 0,99999 – am Deckel baute der Bot dann gar nichts mehr.
  if (rates.powerFactor < POWER_SHORT || rates.grid.served.training < POWER_SHORT) {
    const power = ["kraftwerk", (s.site?.lat ?? 50) >= 47 ? "windpark" : "solarfeld", "raffinerie"].filter(open);
    if (!open("kraftwerk")) power.push("kommandozentrale");
    const pick = tryBuild(c, power.sort((a, b) => score(a) - score(b)), power.length, false);
    if (pick.id) return pick.id;
  }
  // Wer rüsten will, braucht Kaserne und Werft.
  if (c.cfg.militaryShare > 0) {
    const missing = ["kaserne", "werft"].filter((id) => plannedLevel(s, id) === 0);
    if (missing.length) candidates = missing;
  }
  candidates.sort((a, b) => score(a) - score(b));
  // Ungenauigkeit: manchmal ein zufälliger statt des besten Ausbaus.
  if (candidates.length > 1 && c.rand() < c.cfg.noise) {
    const j = Math.floor(c.rand() * candidates.length);
    [candidates[0], candidates[j]] = [candidates[j], candidates[0]];
  }
  if (busy) {
    const next = candidates.find((id) => !missingRequirement(s, id, balance));
    const cost = next ? upgradeCost(next, plannedLevel(s, next), balance) : null;
    if (cost && Object.values(cost).every((n) => n <= cap)) c.reserve = addRes(c.reserve ?? {}, cost);
    return null;
  }
  return tryBuild(c, candidates, 3, true).id;
}

/**
 * Die ersten `n` Kandidaten probieren. Fehlen Rohstoffe für den besten, wird gespart (save): seine Kosten werden zur
 * Rücklage (c.reserve), damit die Ausbildung sie nicht aufbraucht – sonst kam ein teurer Ausbau nie zustande.
 */
function tryBuild(c: PlanCtx, candidates: string[], n: number, save: boolean): { id: string | null } {
  for (const id of candidates.slice(0, n)) {
    const r = startUpgrade(c.state, id, c.nowMs, balance, c.mods);
    if (r.ok) return { id };
    if (r.code === "insufficient_resources" && save) {
      const cost = upgradeCost(id, plannedLevel(c.state, id), balance);
      // Passt der Ausbau gar nicht ins Lager, hilft Sparen nicht: nächster Kandidat (meist das Lager selbst).
      if (Object.values(cost).some((n) => n > storageCapacity(c.state, balance, c.mods))) continue;
      c.reserve = addRes(c.reserve ?? {}, cost);
      return { id: null };
    }
  }
  return { id: null };
}

export function addRes(a: ResourceMap, b: ResourceMap): ResourceMap {
  const out: ResourceMap = { ...a };
  for (const [r, n] of Object.entries(b)) out[r] = (out[r] ?? 0) + n;
  return out;
}

/** Zielanteil der Rüstung: wächst mit der Kommandozentrale bis militaryShare (am Anfang zuerst Wirtschaft). */
export function militaryTarget(cfg: ProfileConfig, s: BaseState): number {
  return cfg.militaryShare * Math.min(1, ((s.buildings.kommandozentrale ?? 0) + 1) / 4);
}

/** Würde der Auftrag die Kommandopunkte oder die Proviantbilanz sprengen? */
function armyFits(s: BaseState, id: string, count: number, mods: Modifiers, nowMs: number): boolean {
  const def = balance.units[id];
  if (!def) return true; // Anlage
  const army: Counts = { ...s.units };
  for (const o of s.trainingQueue) if (o.kind === "unit") army[o.id] = (army[o.id] ?? 0) + o.count;
  army[id] = (army[id] ?? 0) + count;
  if (fleetTotals(army, balance).commandPointsUsed > commandPoints(s, balance) + 1e-9) return false;
  return productionRates(s, balance, mods, nowMs).perHour.proviant - (def.upkeepPerHour ?? 0) * count >= 0;
}

/** Ausbildungsaufträge dieses Zugs (höchstens einer je Baugebäude bzw. Anlagen); saving: für den dringendsten wird gespart. */
export function chooseTraining(c: PlanCtx, extra: Counts = {}): { orders: { id: string; count: number }[]; saving: boolean } {
  let s = c.state;
  const mil = militaryValue(s);
  const bld = buildingsValue(s);
  const full = balance.resources.some((r) => (s.resources[r] ?? 0) > 0.8 * storageCapacity(s, balance, c.mods));
  if (mil > militaryTarget(c.cfg, s) * (mil + bld) && !full) return { orders: [], saving: false };
  const reserve = c.reserve ?? {};
  const doctrine = { ...DOCTRINES[c.profile] };
  for (const [id, n] of Object.entries(extra)) doctrine[id] = (doctrine[id] ?? 0) + n;
  const have = holdings(s);
  const spent: Record<string, number> = {};
  let total = 0;
  for (const id of Object.keys(doctrine)) total += (spent[id] = (have[id] ?? 0) * unitValue(id));
  const shareSum = Object.values(doctrine).reduce((a, b) => a + b, 0);
  const ranked = Object.keys(doctrine)
    .map((id) => ({ id, deficit: (doctrine[id] / shareSum) * (total + 1000) - spent[id] }))
    .sort((a, b) => b.deficit - a.deficit);
  if (ranked.length > 1 && c.rand() < c.cfg.noise) ranked.push(ranked.shift()!);
  const out: { id: string; count: number }[] = [];
  const troops = () => {
    const army: Counts = { ...s.units };
    for (const o of s.trainingQueue) if (o.kind === "unit") army[o.id] = (army[o.id] ?? 0) + o.count;
    return fleetTotals(army, balance);
  };
  for (const { id } of ranked) {
    if (out.length >= 3) break;
    const def = balance.units[id];
    // Truppen brauchen Transportraum: zuerst ein Landungsschiff; ist die Werft belegt, trotzdem die Truppe.
    const picks = [id];
    if (def?.branch === "land" && id !== "spion") {
      const t = troops();
      if (t.troopSize + (def.size ?? 0) * 5 > t.troopSpace) picks.unshift("landungsschiff");
    }
    let done = false;
    for (const pick of picks) {
      // Fehlt der Transportraum und kann das Landungsschiff nicht gebaut werden (außer bei belegter Werft), kommt auch
      // keine Truppe dazu: früher kaufte der Freibeuter Zug um Zug ein paar Schützen (Hunderte ohne Schiff) und kam
      // weder zu Landungsschiffen noch zu Überfällen.
      const transport = pick === "landungsschiff" && picks.length > 1;
      if ((holdings(s)[pick] ?? 0) >= (MAX_HOLD[pick] ?? Infinity)) continue;
      if (c.keepFree?.includes(balance.units[pick]?.builtIn ?? "")) { if (transport) break; continue; }
      // Losgröße: höchstens 45 % des Vorrats je Rohstoff (über der Rücklage) – früher 45 % des Gesamtwerts, dann nahmen
      // die Einheiten den knappen Stahl ganz und kein Ausbau kam mehr zustande. Reicht es nicht für ein Stück, wird gespart.
      const one = trainingCost(pick, 1, balance);
      let count = MAX_BATCH[pick] ?? 10;
      for (const [r, n] of Object.entries(one)) if (n > 0) count = Math.min(count, Math.floor((0.45 * Math.max(0, (s.resources[r] ?? 0) - (reserve[r] ?? 0))) / n));
      if (count >= 1) {
        while (count > 1 && !armyFits(s, pick, count, c.mods, c.nowMs)) count = Math.floor(count / 2);
        if (!armyFits(s, pick, count, c.mods, c.nowMs)) { if (transport) break; continue; }
      }
      const r = count >= 1 ? startTraining(s, pick, count, c.nowMs, balance, c.mods) : { ok: false as const, code: "insufficient_resources" };
      if (!r.ok) {
        // Für den dringendsten sparen – nicht, wenn eine Rücklage für Ausbau oder Kolonieschiff besteht.
        if (r.code === "insufficient_resources" && out.length === 0 && ranked[0].id === id && !c.reserve) return { orders: out, saving: true };
        if (transport && r.code !== "queue_busy") break;
        continue;
      }
      s = r.base;
      out.push({ id: pick, count });
      done = true;
      break;
    }
    if (done && out.length >= 3) break;
  }
  return { orders: out, saving: false };
}

/** Nächste Forschung (nur Heimathafen) oder null. */
export function chooseResearch(c: PlanCtx): string | null {
  const s = c.state;
  if (!balance.research || s.research?.order) return null;
  // Forschung nur bis zu ihrem Anteil am Gebäudewert, sonst fehlt das Geld für den Ausbau.
  let spent = 0;
  for (const [tech, lvl] of Object.entries(s.research?.levels ?? {})) for (let l = 0; l < lvl; l++) spent += value(researchCost(tech, l, balance));
  // Lagebild Stufe 3: steht die Startrampe, kommen die Satelliten-Techniken (aus balance.intel) zuerst, mit doppeltem
  // Forschungsanteil – sonst stiegen erst die früheren Techniken weiter, und kein Bot startete je einen Satelliten.
  const sat = satelliteOf(balance.intel);
  const space = sat && c.profile !== "haendler" && (s.buildings[sat.launchpad] ?? 0) >= 1
    ? Object.values(sat.types).map((t) => t.tech).filter((t) => balance.research?.techs[t] && (s.research?.levels?.[t] ?? 0) < 1)
    : [];
  if (spent > c.cfg.researchShare * (space.length > 0 ? 2 : 1) * buildingsValue(s)) return null;
  for (const tech of [...space, ...RESEARCH[c.profile]]) {
    const r = startResearch(s, tech, c.nowMs, balance, c.mods, 1);
    if (r.ok) return tech;
    if (r.code === "insufficient_resources") return null;
  }
  return null;
}
