// Wetter auf der Karte: Kärtchen „Am Hafen“ und Zeile im Feld-Infoblatt, jeweils mit der Wirkung nach den Regeln
// (Schwellen und Stärken aus balance.weather). Startverbot und Radar gelten nur am eigenen Hafen.
import { BEAUFORT_WORDS, beaufort, fogRadarFactor, stormShare, weatherAt, type Weather, type WeatherBalance } from "@tidefront/game-core";
import { hexCenter } from "@tidefront/world";
import { Icon } from "../icons.tsx";

type Hex = { col: number; row: number };

/** Wirkungen des Wetters an einem Feld; `home`: eigener Hafen, `radar`: dort steht eine Radarstation. */
export function weatherEffects(w: Weather, wb: WeatherBalance, home: boolean, radar: boolean): { text: string; bad: boolean }[] {
  const out: { text: string; bad: boolean }[] = [];
  const share = stormShare(w.wind, wb);
  if (home && w.storm) out.push({ text: "Flugzeuge bleiben am Boden", bad: true });
  if (share > 0) {
    out.push({ text: `Schiffe langsamer (bis +${Math.round(wb.shipSlowMax * share * 100)} %)`, bad: w.storm });
    out.push({ text: `Flugzeuge −${Math.round(wb.airStormPenalty * share * 100)} %`, bad: w.storm });
  }
  if (home && radar) {
    const cut = 100 - Math.round(fogRadarFactor(w.fog, wb) * 100);
    if (cut >= 1) out.push({ text: `Radar −${cut} %`, bad: false });
  }
  if (w.fog >= wb.fogScoutHeavy) out.push({ text: "Aufklärung grob", bad: false });
  else if (w.fog >= wb.fogScoutFrom) out.push({ text: "Aufklärung ungenau", bad: false });
  const strike = Math.round(wb.cloudStrikePenalty * w.clouds * 100);
  if (strike >= 1) out.push({ text: `Luftschlag −${strike} %`, bad: false });
  return out;
}

export const iconOf = (w: Weather, wb: WeatherBalance) =>
  w.storm ? "sturm" : w.fog >= wb.fogScoutFrom ? "nebel" : w.clouds >= 0.55 ? "wolke" : w.wind >= wb.shipSlowFrom ? "wind" : w.daylight > 0 ? "sonne" : "mond";
export const skyOf = (w: Weather, wb: WeatherBalance) =>
  w.storm ? "Sturm" : w.fog >= wb.fogScoutFrom ? "Nebel" : w.clouds >= 0.8 ? "bedeckt" : w.clouds >= 0.55 ? "bewölkt" : w.clouds >= 0.3 ? "heiter" : w.daylight > 0 ? "sonnig" : "sternklar";
const windText = (w: Weather) => `Wind ${beaufort(w.wind)} Bft (${BEAUFORT_WORDS[beaufort(w.wind)]})`;
const fogText = (w: Weather) => (w.fog >= 0.1 ? `Nebel ${Math.round(w.fog * 100)} %` : "");

/** Wetter an einem Feld als Text mit Wirkung (Feld-Infoblatt). */
export function WeatherLine({ at, wb, now, home, radar }: { at: Hex; wb: WeatherBalance; now: number; home: Hex; radar: boolean }) {
  const w = weatherAt(hexCenter(at.col, at.row), now, wb);
  const isHome = at.col === home.col && at.row === home.row;
  const effects = weatherEffects(w, wb, isHome, radar);
  const fog = fogText(w);
  return (
    <div className="text-xs mt-1 flex items-start gap-2">
      <Icon id={iconOf(w, wb)} size={20} />
      <span>
        Wetter hier: {skyOf(w, wb)}, {windText(w)}{fog ? `, ${fog}` : ""}
        {effects.length > 0 && <span className={w.storm ? "text-siegel" : "text-ink2"}> – {effects.map((e) => e.text).join(", ")}</span>}
      </span>
    </div>
  );
}

/** Kärtchen „Am Hafen“ oben auf der Karte. */
export function WeatherChip({ at, wb, now, radar }: { at: Hex; wb: WeatherBalance; now: number; radar: boolean }) {
  const w = weatherAt(hexCenter(at.col, at.row), now, wb);
  // Auf dem Kärtchen nur, was am Hafen zählt: Startverbot, Radar, Flugzeuge im Sturm (Schiffe zeigt die Route).
  const effects = weatherEffects(w, wb, true, radar).filter((e) => /Radar|Flugzeuge/.test(e.text));
  const fog = fogText(w);
  return (
    <div className={`rounded-[3px] bg-card border px-2 py-1 flex items-center gap-2 max-w-[260px] ${w.storm ? "border-siegel border-l-4" : "border-rule"}`}>
      <Icon id={iconOf(w, wb)} size={24} />
      <div className="leading-tight min-w-0">
        <div className="text-[11px] font-display uppercase tracking-wider">Am Hafen: {skyOf(w, wb)}</div>
        <div className="text-[11px] mono text-ink2">Wind {beaufort(w.wind)} Bft{fog ? ` · ${fog}` : ""}</div>
        {effects.length > 0 && <div className={`text-[11px] ${w.storm ? "text-siegel" : "text-ink2"}`}>{effects.map((e) => e.text).join(" · ")}</div>}
      </div>
    </div>
  );
}
