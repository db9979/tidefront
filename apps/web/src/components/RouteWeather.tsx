// Wetter auf der Route in der Missionsplanung (v1.6): Wind, Bewölkung, Nebel und Zeitzuschlag durch Sturm.
import { Icon } from "../icons.tsx";

export interface RouteWeatherData {
  avgWind: number;
  maxWind: number;
  avgClouds: number;
  avgFog: number;
  storminess: number;
  shipFactor: number;
  stormAtOrigin: boolean;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** `factor`: tatsächlicher Zuschlag auf die Reisezeit (1 ohne Schiffe oder ohne Sturm). */
export function RouteWeather({ w, factor }: { w: RouteWeatherData; factor?: number }) {
  const icon = w.stormAtOrigin || w.maxWind >= 0.8 ? "sturm" : w.avgFog >= 0.35 ? "nebel" : w.avgClouds >= 0.55 ? "wolke" : w.avgWind >= 0.5 ? "wind" : "sonne";
  const f = factor ?? 1;
  return (
    <div className="mt-1.5 rounded-lg border border-rule bg-paper p-2 flex gap-2 items-start">
      <Icon id={icon} size={30} className="shrink-0" />
      <div className="text-xs">
        <div className="font-display uppercase tracking-wider text-[10.5px] text-ink2">Wetter auf der Route bei Abfahrt</div>
        <div className="mono">Wind {pct(w.avgWind)} (höchstens {pct(w.maxWind)}) · Wolken {pct(w.avgClouds)} · Nebel {pct(w.avgFog)}</div>
        {f > 1.005 ? (
          <div className="text-red-300">Sturm auf der Route: Reisezeit der Schiffe +{Math.round((f - 1) * 100)} %</div>
        ) : (
          <div className="text-moos">Kein Zeitzuschlag durch Sturm.</div>
        )}
        {w.stormAtOrigin && <div className="text-red-300">Sturm am Hafen: Reine Luftmissionen starten nicht, Flugzeuge kämpfen im Sturm schwächer.</div>}
        {w.avgFog >= 0.35 && <div className="text-ink2">Nebel: Aufklärung liefert nur ein unsicheres Lagebild.</div>}
      </div>
    </div>
  );
}
