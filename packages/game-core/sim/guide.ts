// Simulation Auftragsbuch: derselbe Wirtschafts-Bot einmal ohne und einmal mit den Belohnungen der elf Aufträge
// (balance.json, Schlüssel guide). Ziel: Neulinge kommen schneller in Gang, über die Saison bleibt kein
// nennenswerter Vorsprung. Die Erfüllung folgt packages/engine/src/guide.ts; zwei Annäherungen:
// - Nest: gilt als gewonnen, sobald 2 Korvetten, 1 Landungsschiff und 30 Schützen bereitstehen (der Bot fährt keine Missionen).
// - Radarstation: der Bot baut sie sonst nie; mit Auftragsbuch baut er sie, sobald die ersten zehn abgeholt sind.
import type { Balance, BaseState, ResourceMap } from "../src/index.ts";
import { addResources, startUpgrade } from "../src/index.ts";
import { runBot, value, type BotSnapshot } from "./bot.ts";

interface GuideBalance {
  steps: Record<string, ResourceMap>;
  final: { reward: ResourceMap; buildBoostSeconds: number };
}

const lvl = (s: BaseState, id: string) => s.buildings[id] ?? 0;
const units = (s: BaseState, id: string) => (s.units[id] ?? 0) + (s.unitsAway[id] ?? 0);

const STEPS: [string, (s: BaseState) => boolean][] = [
  ["strom", (s) => lvl(s, "kraftwerk") >= 1],
  ["stahl", (s) => lvl(s, "stahlwerk") >= 1],
  ["basis", (s) => lvl(s, "raffinerie") >= 1 && lvl(s, "versorgungshof") >= 1],
  ["kz", (s) => lvl(s, "kommandozentrale") >= 1],
  ["kaserne", (s) => lvl(s, "kaserne") >= 1],
  ["wache", (s) => units(s, "schuetzen") >= 20],
  ["werft", (s) => lvl(s, "werft") >= 1],
  ["flotte", (s) => units(s, "korvette") >= 2 && units(s, "landungsschiff") >= 1],
  ["nest", (s) => units(s, "korvette") >= 2 && units(s, "landungsschiff") >= 1 && units(s, "schuetzen") >= 30],
  ["hafen", (s) => lvl(s, "hafenkommandantur") >= 3],
  ["schutz", (s) => lvl(s, "radarstation") >= 1 && lvl(s, "tiefbunker") >= 1],
];

const HOUR = 3600000;
const CHECKPOINTS = [1, 2, 3, 5, 7, 10, 14, 21, 28];

function guidedHook(balance: Balance, g: GuideBalance, log: { day: number; step: string }[]) {
  const claimed = new Set<string>();
  let boostPending = false;
  return (base: BaseState, t: number): BaseState => {
    let s = base;
    for (const [id, done] of STEPS) {
      if (claimed.has(id) || !done(s)) continue;
      claimed.add(id);
      log.push({ day: t / (24 * HOUR), step: id });
      s = { ...s, resources: addResources(s.resources, g.steps[id] ?? {}) };
    }
    // Dem Auftragsbuch folgen: Radarstation, wenn sonst nur noch sie fehlt.
    if (claimed.size === 10 && !claimed.has("schutz") && lvl(s, "radarstation") === 0 && s.buildQueue.length === 0) {
      const r = startUpgrade(s, "radarstation", t, balance);
      if (r.ok) s = r.base;
    }
    if (claimed.size === STEPS.length && !claimed.has("final")) {
      claimed.add("final");
      log.push({ day: t / (24 * HOUR), step: "final" });
      s = { ...s, resources: addResources(s.resources, g.final.reward) };
      boostPending = true;
    }
    // −1 Stunde für den laufenden (sonst den nächsten) Ausbau.
    if (boostPending && s.buildQueue.length > 0) {
      boostPending = false;
      const delta = Math.max(0, Math.min(g.final.buildBoostSeconds * 1000, s.buildQueue[0].finishesAt - t));
      s = { ...s, buildQueue: s.buildQueue.map((o, i) => (i === 0 ? { ...o, finishesAt: o.finishesAt - delta } : { ...o, startedAt: o.startedAt - delta, finishesAt: o.finishesAt - delta })) };
    }
    return s;
  };
}

const spent = (x: BotSnapshot) => x.spentBuild + x.spentMil;

/** Wann erreicht der Bot ohne Auftragsbuch den Wert target (linear zwischen Tagen)? Ergebnis: Stunden nach `day`. */
function catchUpHours(daily: BotSnapshot[], day: number, target: number): string {
  let prev = { day: 0, v: 0 };
  for (const x of daily) {
    const v = spent(x);
    if (v >= target) {
      const at = prev.day + ((target - prev.v) / (v - prev.v || 1)) * (x.day - prev.day);
      return ((at - day) * 24).toFixed(0);
    }
    prev = { day: x.day, v };
  }
  return ">" + ((daily[daily.length - 1].day - day) * 24).toFixed(0);
}

export function runGuideSim(balance: Balance): void {
  const g = (balance as unknown as { guide?: GuideBalance }).guide;
  if (!g) return;
  const sum = (m: ResourceMap) => Object.values(m).reduce((a, b) => a + b, 0);
  const steps = Object.values(g.steps).reduce((a, m) => a + sum(m), 0);
  const all = [...Object.values(g.steps), g.final.reward].reduce((a, m) => addResources(a, m), {} as ResourceMap);
  console.log(
    `\nAuftragsbuch: Pakete der elf Aufträge ${steps}, Abschluss ${sum(g.final.reward)} (+ −${g.final.buildBoostSeconds / 3600} h Bauzeit), ` +
      `gesamt ${sum(all)} Ressourcen (${Math.round(value(all, balance))} Stahl-Äquivalent)`,
  );
  // Ohne Auftragsbuch täglich, damit sich der Zeitvorsprung interpolieren lässt.
  const daily = runBot(balance, 32, Array.from({ length: 32 }, (_, i) => i + 1));
  const plain = daily.filter((x) => CHECKPOINTS.includes(x.day));
  const log: { day: number; step: string }[] = [];
  const guided = runBot(balance, 28, CHECKPOINTS, undefined, undefined, guidedHook(balance, g, log));
  // Vergleich mit der Anfangsproduktion: Tagesmenge des Bots nach Tag 1 (Ressourcen, ohne Bewertung).
  const day1 = plain.find((s) => s.day === 1)!;
  const day2 = plain.find((s) => s.day === 2)!;
  console.log(`  Ausgaben des Bots ohne Auftragsbuch: Tag 1 ${Math.round(spent(day1))}, Tag 2 ${Math.round(spent(day2) - spent(day1))} (Stahl-Äquivalent)`);
  console.log(`  Abgeholt: ${log.map((l) => `${l.step} ${l.day.toFixed(1)}`).join(", ")} (Tag)`);
  console.log(`  Ausgaben zum Richtwert (Ausbau + Rüstung, kumuliert); Zeitvorsprung = Stunden, die der Bot ohne Auftragsbuch braucht, um gleichzuziehen`);
  console.log(`  ${"Tag".padEnd(5)}${"Aufträge".padStart(9)}${"ohne".padStart(10)}${"mit".padStart(10)}${"Vorsprung".padStart(11)}${"Zeit".padStart(9)}${"KZ ohne/mit".padStart(13)}`);
  for (const [i, a] of plain.entries()) {
    const b = guided[i];
    const done = log.filter((l) => l.day <= a.day).length;
    const lead = spent(a) > 0 ? (spent(b) / spent(a) - 1) * 100 : 0;
    console.log(
      `  ${String(a.day).padEnd(5)}${String(done).padStart(9)}${String(Math.round(spent(a))).padStart(10)}${String(Math.round(spent(b))).padStart(10)}` +
        `${`${lead >= 0 ? "+" : ""}${lead.toFixed(1)} %`.padStart(11)}${`${catchUpHours(daily, a.day, spent(b))} h`.padStart(9)}${`${a.base.buildings.kommandozentrale}/${b.base.buildings.kommandozentrale}`.padStart(13)}`,
    );
  }
}
