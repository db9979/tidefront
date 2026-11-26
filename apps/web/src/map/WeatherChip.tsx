// Kleines Wetterkärtchen auf der Karte: Lage am eigenen Hafen (Wind, Himmel, Nebel, Sturm).
import { weatherAt, type WeatherBalance } from "@tidefront/game-core";
import { hexCenter } from "@tidefront/world";
import { Icon } from "../icons.tsx";

/** Windstärke 0–1 grob in Beaufort (0–12). */
export const beaufort = (wind: number) => Math.max(0, Math.min(12, Math.round(wind * 12)));

export function WeatherChip({ at, wb, now }: { at: { col: number; row: number }; wb: WeatherBalance; now: number }) {
  const w = weatherAt(hexCenter(at.col, at.row), now, wb);
  const icon = w.storm ? "sturm" : w.fog >= 0.45 ? "nebel" : w.clouds >= 0.55 ? "wolke" : w.daylight > 0 ? "sonne" : "wind";
  const sky = w.storm ? "Sturm" : w.fog >= 0.45 ? "Nebel" : w.clouds >= 0.8 ? "bedeckt" : w.clouds >= 0.55 ? "bewölkt" : w.clouds >= 0.3 ? "heiter" : w.daylight > 0 ? "sonnig" : "klar";
  return (
    <div className={`rounded-[3px] bg-card border px-2 py-1 flex items-center gap-2 ${w.storm ? "border-siegel border-l-4" : "border-rule"}`}>
      <Icon id={icon} size={24} />
      <div className="leading-tight">
        <div className="text-[11px] font-display uppercase tracking-wider">Am Hafen: {sky}</div>
        <div className="text-[11px] mono text-ink2">Wind {beaufort(w.wind)} Bft{w.fog >= 0.3 ? ` · Nebel ${Math.round(w.fog * 100)} %` : ""}</div>
      </div>
    </div>
  );
}
