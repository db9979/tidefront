// „Im Kampfsimulator öffnen“: wandelt einen Bericht (Daten wie report.get sie liefert) in eine Vorbelegung des
// freien Simulators um – Verbände VOR dem Kampf, Anlagen, Wetter, Modifikatoren beider Seiten, soweit gespeichert.
// Was fehlt, wird neutral angesetzt und in `notes` offen benannt. Aufklärungsberichte liefern nur das Ziel; den
// Angreifer (eigener Bestand daheim) setzt die Oberfläche ein.
import type { Balance, Counts, ResourceMap } from "./types.ts";
import type { AttackerInput, DefenderInput, Side } from "./types-combat.ts";
import type { CombatWeather } from "./weather.ts";
import type { BattleSetup, BattleSetupSide } from "./battle-setup.ts";
import type { Modifiers } from "./modifiers.ts";

export interface ReportSimPreset {
  /** kampf: echter Kampf nachgestellt; aufklaerung: aufgeklärtes Ziel, Angreifer = eigener Bestand. */
  source: "kampf" | "aufklaerung";
  /** Seite des Lesers. */
  mine: Side;
  names: [string, string];
  /** null bei Aufklärung (eigener Bestand daheim). */
  attacker: AttackerInput | null;
  defender: DefenderInput;
  weather?: CombatWeather;
  /** Mittleres Kriegsglück je Seite im echten Kampf (Faktor), null ohne Würfe. */
  luck: { attacker: number; defender: number } | null;
  winner: Side | null;
  /** Transparenz: was geschätzt oder unbekannt ist. */
  notes: string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const counts = (v: unknown): Counts => {
  const o = obj(v);
  if (!o) return {};
  const out: Counts = {};
  for (const [k, n] of Object.entries(o)) if (typeof n === "number" && Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
  return out;
};
const hasAny = (c: Counts) => Object.values(c).some((n) => n > 0);

/** Teilt eine gemeinsame Zählung des Verteidigers in Einheiten und Anlagen. */
export function splitForces(all: Counts, balance: Pick<Balance, "defenses">): { units: Counts; defenses: Counts } {
  const units: Counts = {};
  const defenses: Counts = {};
  for (const [id, n] of Object.entries(all)) {
    if (!(n > 0)) continue;
    if (Object.hasOwn(balance.defenses, id)) defenses[id] = n;
    else units[id] = n;
  }
  return { units, defenses };
}

function avgLuck(phases: unknown): { attacker: number; defender: number } | null {
  if (!Array.isArray(phases)) return null;
  const f = phases.map((p) => obj(obj(p)?.luckFactor)).filter((x): x is Obj => !!x && typeof x.attacker === "number" && typeof x.defender === "number");
  if (!f.length) return null;
  const mean = (k: "attacker" | "defender") => f.reduce((s, x) => s + (x[k] as number), 0) / f.length;
  return { attacker: mean("attacker"), defender: mean("defender") };
}

const WHO: Record<Side, string> = { attacker: "Angreifer", defender: "Verteidiger" };

/**
 * Bericht → Vorbelegung; null, wenn der Bericht keinen nachstellbaren Kampf und kein Ziel enthält.
 * opponentIsPlayer: Gegner des Lesers ist ein Spieler – dessen Forschung bleibt unbekannt (auch bei alten Berichten).
 */
export function reportSimPreset(
  kind: string,
  role: string,
  data: Obj,
  balance: Pick<Balance, "defenses">,
  opts: { opponentIsPlayer?: boolean } = {},
): ReportSimPreset | null {
  const mine: Side = role === "defender" ? "defender" : "attacker";
  const opp: Side = mine === "attacker" ? "defender" : "attacker";
  const names: [string, string] = [typeof data.attackerName === "string" ? data.attackerName : "Angreifer", typeof data.defenderName === "string" ? data.defenderName : "Verteidiger"];
  const battle = obj(data.battle);
  if (battle && kind !== "spionage") return fromBattle(battle, data, mine, opp, names, balance, !!opts.opponentIsPlayer);
  return fromScout(data, names);
}

function fromBattle(battle: Obj, data: Obj, mine: Side, opp: Side, names: [string, string], balance: Pick<Balance, "defenses">, oppPlayer: boolean): ReportSimPreset | null {
  const aUnits = counts(obj(battle.attacker)?.before);
  const dAll = counts(obj(battle.defender)?.before);
  if (!hasAny(aUnits)) return null;
  const notes: string[] = [];
  const stored = obj(battle.setup) as BattleSetup | null;
  let a: BattleSetupSide;
  let d: BattleSetupSide;
  if (stored) {
    a = stored.attacker ?? {};
    d = stored.defender ?? {};
  } else {
    // Ältere Berichte: Eingaben des Angreifers liegen oft unter data.attacker (AttackerInput), der Verteidiger fehlt.
    notes.push("Älterer Bericht: Kampfbedingungen nur teilweise gespeichert.");
    const old = obj(data.attacker);
    a = old ? {
      versorgungsmangel: old.versorgungsmangel === true || undefined,
      modifiers: obj(old.modifiers) ? (old.modifiers as Modifiers) : undefined,
      troopSpaceBonus: hasAny(counts(old.troopSpaceBonus)) ? counts(old.troopSpaceBonus) : undefined,
      unlimitedCargo: old.unlimitedCargo === true || undefined,
      weakTarget: old.weakTarget === true || undefined,
      priorAttacksInWindow: typeof old.priorAttacksInWindow === "number" ? old.priorAttacksInWindow : undefined,
    } : {};
    if (!old || !old.modifiers) notes.push("Modifikatoren des Angreifers nicht gespeichert – mit 0 gerechnet.");
    d = typeof data.protectedPerResource === "number" ? { protectedPerResource: data.protectedPerResource, shareLoot: true } : {};
    notes.push("Forschung, Admiral und Versorgung des Verteidigers nicht gespeichert – mit 0 gerechnet.");
  }
  const sides: Record<Side, BattleSetupSide> = { attacker: { ...a }, defender: { ...d } };
  // Forschung eines Spieler-Gegners bleibt geheim (Server entfernt sie; alte Berichte hier ebenso).
  if (oppPlayer && (sides[opp].modifiers || sides[opp].modifiersHidden || stored)) {
    delete sides[opp].modifiers;
    notes.push(`Forschung und Admiral des Gegners (${WHO[opp]}) unbekannt – mit 0 gerechnet.`);
  } else if (sides[opp].modifiersHidden) {
    notes.push(`Forschung und Admiral des Gegners unbekannt – mit 0 gerechnet.`);
  }
  if (stored && sides[mine].modifiers) notes.push("Deine Modifikatoren (Forschung, Admiral, Veteranen) wie im echten Kampf.");
  const loot = counts(battle.loot);
  let fixedLoot: ResourceMap | undefined = sides.defender.fixedLoot;
  if (!fixedLoot) {
    // Bestände des Ziels sind nicht gespeichert: die tatsächliche Beute dient als feste Beute.
    fixedLoot = loot as ResourceMap;
    if (hasAny(loot) || sides.defender.shareLoot) notes.push("Bestände des Ziels nicht gespeichert – Beute mit der tatsächlichen Beute angesetzt.");
  }
  const weather = obj(battle.weather) as CombatWeather | null;
  if (!weather) notes.push("Wetter nicht gespeichert – ohne Wettereinfluss gerechnet.");
  const attacker: AttackerInput = {
    units: aUnits,
    ...(sides.attacker.versorgungsmangel ? { versorgungsmangel: true } : {}),
    ...(sides.attacker.modifiers ? { modifiers: sides.attacker.modifiers } : {}),
    ...(sides.attacker.troopSpaceBonus ? { troopSpaceBonus: sides.attacker.troopSpaceBonus } : {}),
    ...(sides.attacker.unlimitedCargo ? { unlimitedCargo: true } : {}),
    ...(sides.attacker.weakTarget ? { weakTarget: true } : {}),
    ...(sides.attacker.priorAttacksInWindow ? { priorAttacksInWindow: sides.attacker.priorAttacksInWindow } : {}),
  };
  const split = splitForces(dAll, balance);
  const defender: DefenderInput = {
    ...split,
    fixedLoot,
    ...(sides.defender.versorgungsmangel ? { versorgungsmangel: true } : {}),
    ...(sides.defender.modifiers ? { modifiers: sides.defender.modifiers } : {}),
    ...(sides.defender.protectedPerResource !== undefined ? { protectedPerResource: sides.defender.protectedPerResource } : {}),
  };
  if (sides.attacker.versorgungsmangel || sides.defender.versorgungsmangel) {
    notes.push(`Versorgungsmangel eingerechnet (${[sides.attacker.versorgungsmangel ? names[0] : null, sides.defender.versorgungsmangel ? names[1] : null].filter(Boolean).join(", ")}).`);
  }
  const winner = battle.winner === "attacker" || battle.winner === "defender" ? battle.winner : null;
  return { source: "kampf", mine, names, attacker, defender, ...(weather ? { weather } : {}), luck: avgLuck(battle.phases), winner, notes };
}

function fromScout(data: Obj, names: [string, string]): ReportSimPreset | null {
  const nest = obj(data.nest);
  const garrison = obj(nest?.garrison);
  if (nest && garrison && nest.empty !== true) {
    return {
      source: "aufklaerung", mine: "attacker", names: ["Dein Verband", `Piratennest Stufe ${String(nest.level ?? "?")}`], attacker: null,
      defender: { units: counts(garrison.units), defenses: counts(garrison.defenses), fixedLoot: counts(garrison.loot) as ResourceMap },
      luck: null, winner: null, notes: ["Besatzung laut Aufklärung; Angreifer: dein Bestand daheim mit deinen aktuellen Modifikatoren."],
    };
  }
  const scout = obj(data.scout);
  if (!scout) return null;
  const units = counts(scout.units);
  const defenses = counts(scout.defenses);
  if (!hasAny(units) && !hasAny(defenses) && !hasAny(counts(scout.resources))) return null;
  const notes = ["Forschung und Admiral des Ziels unbekannt – mit 0 gerechnet.", "Angreifer: dein Bestand daheim mit deinen aktuellen Modifikatoren."];
  if (obj(scout.uncertain)) notes.push("Sichtung unsicher – Zahlen gerundet.");
  return {
    source: "aufklaerung", mine: "attacker", names: ["Dein Verband", typeof data.targetName === "string" ? data.targetName : names[1]], attacker: null,
    defender: {
      units, defenses, resources: counts(scout.resources) as ResourceMap,
      ...(typeof scout.protectedPerResource === "number" ? { protectedPerResource: scout.protectedPerResource } : {}),
    },
    luck: null, winner: null, notes,
  };
}
