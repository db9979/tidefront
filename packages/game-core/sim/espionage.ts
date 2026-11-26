// Nachrichtendienst (v1.7): Erfolgs- und Enttarnungschancen über typische Spielverläufe, Abwehr gegen Ausbau,
// Kosten und Nutzen der Sabotage, Desinformation. Die Chance ist exakt (Zielzahl / W20), kein Seed nötig.
// Vergleich „vorher“ = Werte v1.6 (unten fest), „nachher“ = aktuelle Balance.
import type { Balance, BaseState, Modifiers } from "../src/index.ts";
import type { EspionageBalance, SpyKind } from "../src/index.ts";
import { productionRates, researchModifiers, spyChance, spyDefenseValue, spySuccessValue, trainingCost } from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { value } from "./bot.ts";

/** Werte v1.6 (Vergleich). */
function v16(e: EspionageBalance): EspionageBalance {
  return {
    ...e,
    base: 9,
    maxXpPoints: 3,
    kinds: {
      erkunden: { ...e.kinds.erkunden, bonus: 2 },
      desinformation: { ...e.kinds.desinformation, bonus: 0 },
      sabotage: { ...e.kinds.sabotage, spies: 2, bonus: -3 },
      kartell: { ...e.kinds.kartell, defense: 5 },
    },
    disinfo: { ...e.disinfo, forceFactor: 1.8 },
  };
}

/** Ausbau eines Hafens: Stufe Nachrichtendienst, Forschung (beide Techniken gleich), gelungene Aufträge. */
interface Profile {
  label: string;
  level: number;
  research: number;
  successes: number;
}

/** Typischer Stand je Tag für einen Spieler, der den Nachrichtendienst nebenher ausbaut (KZ des Bots: 1/2/4/7). */
const TYPICAL: { day: number; p: Profile }[] = [
  { day: 3, p: { label: "Stufe 2", level: 2, research: 0, successes: 0 } },
  { day: 7, p: { label: "Stufe 3", level: 3, research: 0, successes: 3 } },
  { day: 14, p: { label: "Stufe 5, Forschung 1", level: 5, research: 1, successes: 8 } },
  { day: 28, p: { label: "Stufe 8, Forschung 2", level: 8, research: 2, successes: 20 } },
];

function withIntel(base: BaseState, p: Profile, balance: Balance): BaseState {
  const id = balance.espionage!.building;
  return { ...base, buildings: { ...base.buildings, [id]: p.level }, intel: { successes: p.successes } };
}

function mods(p: Profile, balance: Balance): Modifiers {
  return researchModifiers({ agentenschulung: p.research, verschluesselung: p.research }, balance);
}

/** Erfolgschance; null, wenn die Auftragsart auf dieser Stufe nicht erlaubt ist. */
function chance(base: BaseState, att: Profile, def: Profile | null, kind: SpyKind, balance: Balance): number | null {
  const e = balance.espionage!;
  if (att.level < e.kinds[kind].minLevel) return null;
  const a = withIntel(base, att, balance);
  const s = spySuccessValue(a, kind, balance, mods(att, balance)).total;
  const d = def ? spyDefenseValue(withIntel(base, def, balance), kind, balance, mods(def, balance)).total : spyDefenseValue(null, kind, balance).total;
  return spyChance(s, d, e.die);
}

const pct = (x: number | null) => (x === null ? "   –" : `${Math.round(x * 100)} %`.padStart(4));
const KINDS: SpyKind[] = ["erkunden", "desinformation", "sabotage", "kartell"];

export function runEspionageSim(balance: Balance, snaps: BotSnapshot[]): void {
  const e = balance.espionage;
  if (!e) return;
  const old: Balance = { ...balance, espionage: v16(e) };
  const snap = (day: number) => snaps.find((s) => s.day === day) ?? snaps[snaps.length - 1];
  const spyValue = value(trainingCost(e.unit, 1, balance), balance);
  console.log(`\nNachrichtendienst (v1.7): offener W${e.die}, Chance = Zielzahl / ${e.die} (1 … ${e.die - 1}), Spion ${Math.round(spyValue)} Stahl-Äquivalent`);
  console.log(`  Werte: Grundwert ${e.base}, Zuschläge ${KINDS.map((k) => `${k} ${e.kinds[k].bonus >= 0 ? "+" : ""}${e.kinds[k].bonus}`).join(", ")}, Kartell-Abwehr ${e.kinds.kartell.defense}, Erfahrung höchstens +${e.maxXpPoints} (je ${e.xpPerPoint})`);

  console.log(`\n  Gleich starker Gegner (gleiche Stufe und Forschung), Erfolg % vorher (v1.6) → nachher; Kartell ohne Gegner`);
  console.log(`  ${"Tag".padEnd(4)}${"Stand (gelungene Aufträge)".padEnd(34)}${KINDS.map((k) => k.padStart(16)).join("")}`);
  for (const { day, p } of TYPICAL) {
    const b = snap(day).base;
    const cells = KINDS.map((k) => {
      const def = k === "kartell" ? null : p;
      return `${pct(chance(b, p, def, k, old))} → ${pct(chance(b, p, def, k, balance))}`.padStart(16);
    });
    console.log(`  ${String(day).padEnd(4)}${`${p.label} (${p.successes})`.padEnd(34)}${cells.join("")}`);
  }

  // Ausbau gegen Ausbau (Tag 14, nachher): Erkunden / Sabotage.
  const attackers: Profile[] = [
    { label: "Angreifer Stufe 3", level: 3, research: 0, successes: 0 },
    { label: "Angreifer Stufe 5, F1, Erf. 1", level: 5, research: 1, successes: 5 },
    { label: "Angreifer Stufe 8, F2, Erf. max", level: 8, research: 2, successes: 20 },
    { label: "Angreifer Stufe 10, F2, Erf. max", level: 10, research: 2, successes: 20 },
  ];
  const defenders: Profile[] = [
    { label: "ohne", level: 0, research: 0, successes: 0 },
    { label: "St. 3", level: 3, research: 0, successes: 0 },
    { label: "St. 5 F1", level: 5, research: 1, successes: 0 },
    { label: "St. 8 F2", level: 8, research: 2, successes: 0 },
    { label: "St. 10 F2", level: 10, research: 2, successes: 0 },
    { label: "St. 20 F2", level: 20, research: 2, successes: 0 },
  ];
  console.log(`\n  Ausbau gegen Ausbau (nachher): Erkunden / Sabotage – Abwehr des Ziels (St. 10 = Höchststufe bei KZ 7, St. 20 = Endausbau)`);
  console.log(`  ${"".padEnd(34)}${defenders.map((d) => d.label.padStart(13)).join("")}`);
  const b14 = snap(14).base;
  for (const a of attackers) {
    const cells = defenders.map((d) => `${pct(chance(b14, a, d, "erkunden", balance))}/${pct(chance(b14, a, d, "sabotage", balance))}`.padStart(13));
    console.log(`  ${a.label.padEnd(34)}${cells.join("")}`);
  }
  let lowest = 1;
  for (const a of attackers) for (const d of defenders) for (const k of KINDS) lowest = Math.min(lowest, chance(b14, a, d, k, balance) ?? 1);
  console.log(`  Niedrigste Chance überhaupt: ${pct(lowest)} (Untergrenze Zielzahl 1)`);

  // Sabotage: erwartete Spionverluste je gelungener Sabotage gegen den Schaden (Kraftwerk: halbe Gebäudeproduktion).
  const t = e.sabotage;
  console.log(
    `\n  Sabotage (${old.espionage!.kinds.sabotage.spies} → ${e.kinds.sabotage.spies} Spion(e), ${t.hours} h Ausfall, Kraftwerk: Gebäudeproduktion ×${t.productionFactor}) gegen gleich starken Gegner:` +
      ` Spionverlust je Erfolg = Spione × (1 − p) / p`,
  );
  console.log(`  ${"Tag".padEnd(4)}${"Chance vorher → nachher".padEnd(26)}${"Verlust je Erfolg (Stahl-Äq.)".padEnd(32)}Schaden Kraftwerk (Stahl-Äq.)`);
  for (const { day, p } of TYPICAL) {
    const b = snap(day).base;
    const before = chance(b, p, p, "sabotage", old);
    const after = chance(b, p, p, "sabotage", balance);
    const loss = (c: number | null, b: Balance) =>
      c === null ? "–" : String(Math.round(((b.espionage!.kinds.sabotage.spies * (1 - c)) / c) * spyValue));
    const perHour = value(productionRates(b, balance).buildingPerHour, balance);
    const damage = perHour * t.hours * (1 - t.productionFactor);
    console.log(
      `  ${String(day).padEnd(4)}${`${pct(before)} → ${pct(after)}`.padEnd(26)}${`${loss(before, old)} → ${loss(after, balance)}`.padEnd(32)}${Math.round(damage)} (Produktion ${Math.round(perHour)}/h)`,
    );
  }

  // Desinformation: Wie stark wirkt das verfälschte Lagebild? Ein Angreifer greift an, wenn er sich ≥ 1,5-fach überlegen sieht.
  const d = e.disinfo;
  console.log(
    `\n  Desinformation (Truppen ×${old.espionage!.disinfo.forceFactor} → ×${d.forceFactor}, Bestände ×${d.resourceFactor}, einmalig, ${d.hours} h): gesehene Überlegenheit des Angreifers`,
  );
  const ratios = [1.5, 2, 2.5, 3];
  for (const f of [old.espionage!.disinfo.forceFactor, d.forceFactor]) {
    console.log(`  ×${f}: ${ratios.map((r) => `echt ${r.toFixed(1)}:1 → gesehen ${(r / f).toFixed(2)}:1`).join(" · ")}`);
  }
  const p14 = TYPICAL.find((x) => x.day === 14)!.p;
  const c14 = chance(b14, p14, p14, "desinformation", balance) ?? 0;
  const c14e = chance(b14, p14, p14, "erkunden", balance) ?? 0;
  console.log(
    `  Tag 14 gleich stark: Desinformation gelingt ${pct(c14)}, Erkunden ${pct(c14e)}; zweites Lagebild ist wieder echt` +
      ` → mit zwei Lagebildern sieht der Angreifer die Wahrheit, sobald eins davon nicht verfälscht ist.`,
  );
}
