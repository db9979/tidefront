// Sieger nach Kampfart: resolveBattle entscheidet nach der Landung („Ziel eingenommen“). Bei Kämpfen auf See gegen
// einen Verband (Weltereignis, Saisonfinale, Feld, Konvoi, Blockadekampf) gilt dagegen „Gegner vernichtet“: Sinken
// alle Schiffe des Verteidigers, ertrinken die Truppen an Bord (strandTroops). Server und Kampfsimulator nutzen
// dieselbe Funktion `settleBattle`, damit Probekampf und echter Kampf dieselbe Siegregel haben. Dazu die Beuteregel
// je Kampfart für den Simulator (der Server rechnet die Beute mit den Daten des Ereignisses selbst).
import type { Balance, BattleReport, Counts, ResourceMap } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";
import { capLoot, strandTroops } from "./world-events.ts";
import { fleetTotals } from "./mission.ts";
import { convoyPlunder } from "./naval.ts";
import { finaleLoot } from "./finale.ts";

/**
 * landung: Sieg mit gelandeten Truppen (Nest, Hafen); vernichtung: alle Einheiten des Verteidigers vernichtet;
 * halten (Konvoi, Feld; Hotfix 0.38.1, TST-01): wie vernichtung, aber getauchte Einheiten (U-Boote) halten nicht –
 * bleiben nur sie übrig, ist der Konvoi bzw. das Feld verloren (die U-Boote selbst überleben).
 */
export type VictoryRule = "landung" | "vernichtung" | "halten";

/** Kampfarten, bei denen „Gegner vernichtet“ gilt (Berichtsart). */
const DESTROY_KINDS = new Set(["weltereignis", "blockadekampf"]);
/** Kampfarten, bei denen der Verteidiger etwas halten muss (getauchte Einheiten zählen nicht). */
const HOLD_KINDS = new Set(["feld", "konvoi"]);

/** Siegregel eines Berichts (Art und Daten wie report.get sie liefert). */
export function victoryRuleOf(kind: string, data?: Record<string, unknown> | null): VictoryRule {
  if (HOLD_KINDS.has(kind)) return "halten";
  if (DESTROY_KINDS.has(kind)) return "vernichtung";
  if (data && (data.field || data.convoy)) return "halten";
  if (data && (data.worldEvent || data.blockade)) return "vernichtung";
  return "landung";
}

/**
 * Bericht nach der Siegregel: landung lässt ihn unverändert, vernichtung ersetzt den Sieger nach strandTroops
 * (Truppen ohne Schiffe ertrinken). destroyed: Verteidiger vernichtet bzw. (landung) Angreifer hat gesiegt.
 */
export function settleBattle(report: BattleReport, balance: Balance, rule: VictoryRule): { report: BattleReport; destroyed: boolean } {
  if (rule === "landung") return { report, destroyed: report.winner === "attacker" };
  return strandTroops(report, balance, rule !== "halten");
}

/** Beute je Kampfart im Simulator. */
export type LootRule =
  /** Beute aus resolveBattle (Nest: fest, Hafen: Anteil am Bestand). */
  | { kind: "kampf" }
  /** Keine Beute (Feld, Blockade, Konvoi-Abwehr). */
  | { kind: "keine" }
  /** Anteil am Beutepool je vernichtetem Lebenspunkt (Großflotte, Belagerung), durch den Laderaum begrenzt. */
  | { kind: "jeLp"; perHp: ResourceMap }
  /** Saisonfinale: Beute je vernichtetem Lebenspunkt aus der Balance (ohne Laderaumgrenze, ohne Schatz). */
  | { kind: "finale" }
  /** Feste Beute nur bei Vernichtung (Schatzschiff), durch den Laderaum begrenzt. */
  | { kind: "beiVernichtung"; loot: ResourceMap }
  /** Konvoi abgefangen: Anteil der Ladung bei Vernichtung des Geleits, durch den Laderaum begrenzt. */
  | { kind: "konvoi"; cargo: ResourceMap }
  /** Unbekannt (Bestände des Ziels nicht gespeichert): der Simulator zeigt keine Beute. */
  | { kind: "unbekannt" };

const allHp = (balance: Balance) => {
  const all: Record<string, { hp?: number }> = { ...balance.units, ...balance.npcUnits, ...balance.defenses };
  return (c: Counts) => Object.entries(c).reduce((s, [id, n]) => s + (all[id]?.hp ?? 0) * Math.max(0, n), 0);
};

/** Vernichtete Lebenspunkte des Verteidigers (Grundwerte) in einem (nach der Siegregel angepassten) Bericht. */
export function destroyedDefenderHp(report: BattleReport, balance: Balance): number {
  const hp = allHp(balance);
  return Math.max(0, hp(report.defender.before) - hp(report.defender.final));
}

const zero = (balance: Balance): ResourceMap => Object.fromEntries(balance.resources.map((r) => [r, 0]));

/** Beute eines (angepassten) Berichts nach der Beuteregel; Laderaum der Überlebenden des Angreifers. */
export function lootByRule(report: BattleReport, destroyed: boolean, rule: LootRule, balance: Balance, mods?: Modifiers): ResourceMap {
  const out = zero(balance);
  const cargo = () => fleetTotals(Object.fromEntries(Object.entries(report.attacker.final).filter(([id]) => balance.units[id])), balance, mods).cargoCapacity;
  const fill = (m: ResourceMap) => { for (const [r, v] of Object.entries(m)) out[r] = (out[r] ?? 0) + v; return out; };
  switch (rule.kind) {
    case "kampf": return { ...out, ...report.loot };
    case "keine": case "unbekannt": return out;
    case "jeLp": {
      const hp = destroyedDefenderHp(report, balance);
      return fill(capLoot(Object.fromEntries(Object.entries(rule.perHp).map(([r, v]) => [r, v * hp])), cargo()));
    }
    case "finale": return fill(finaleLoot(destroyedDefenderHp(report, balance), balance));
    case "beiVernichtung": return destroyed ? fill(capLoot(rule.loot, cargo())) : out;
    case "konvoi": return destroyed ? fill(convoyPlunder(rule.cargo, cargo(), balance)) : out;
  }
}
