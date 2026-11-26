// Wetter in der Missionsplanung (v1.6, v1.9): Wind auf der Route bei Abfahrt (Zeitzuschlag, Startverbot) und das
// Wetter am Ziel zur voraussichtlichen Ankunft (Nebel → Aufklärung, Sturm → Flugzeuge, Wolken → Luftschlag).
// Alle Schwellen aus balance.weather.
import { BEAUFORT_WORDS, beaufort, stormShare, type RouteWeather as RouteWeatherData, type WeatherBalance } from "@tidefront/game-core";
import { Icon } from "../icons.tsx";
import { fmtTime } from "../lib/time.ts";

/** `factor`: tatsächlicher Zuschlag auf die Reisezeit (1 ohne Schiffe oder ohne Sturm). */
export function RouteWeather({ w, wb, factor }: { w: RouteWeatherData; wb: WeatherBalance; factor?: number }) {
  const t = w.atTarget;
  const fog = t ? t.fog : w.avgFog;
  const icon = w.stormAtOrigin || w.maxWind >= wb.stormFrom ? "sturm" : fog >= wb.fogScoutFrom ? "nebel" : w.avgClouds >= 0.55 ? "wolke" : w.avgWind >= wb.shipSlowFrom ? "wind" : "sonne";
  const f = factor ?? 1;
  const air = t ? Math.round(wb.airStormPenalty * stormShare(t.wind, wb) * 100) : 0;
  const strike = t ? Math.round(wb.cloudStrikePenalty * t.clouds * 100) : 0;
  return (
    <div className="mt-1.5 rounded-lg border border-rule bg-paper p-2 flex gap-2 items-start">
      <Icon id={icon} size={30} className="shrink-0" />
      <div className="text-xs">
        <div className="font-display uppercase tracking-wider text-[10.5px] text-ink2">Wetter auf der Route bei Abfahrt</div>
        <div className="mono">Wind im Mittel {beaufort(w.avgWind)} Bft, höchstens {beaufort(w.maxWind)} Bft ({BEAUFORT_WORDS[beaufort(w.maxWind)]})</div>
        {f > 1.005 ? (
          <div className="text-siegel">Sturm auf der Route: Reisezeit der Schiffe +{Math.round((f - 1) * 100)} %</div>
        ) : (
          <div className="text-moos">Kein Zeitzuschlag durch Sturm.</div>
        )}
        {w.stormAtOrigin && <div className="text-siegel">Sturm am Hafen: Reine Luftmissionen starten nicht.</div>}
        {t && (
          <>
            <div className="font-display uppercase tracking-wider text-[10.5px] text-ink2 mt-1.5">Am Ziel bei Ankunft ({fmtTime(t.atMs)})</div>
            <div className="mono">Wind {beaufort(t.wind)} Bft · Wolken {Math.round(t.clouds * 100)} % · Nebel {Math.round(t.fog * 100)} %</div>
            {air > 0 && <div className={t.storm ? "text-siegel" : "text-ink2"}>Flugzeuge kämpfen schwächer (−{air} %).</div>}
            {strike >= 1 && <div className="text-ink2">Wolken: Luftschlag der Bomber −{strike} %.</div>}
          </>
        )}
        {fog >= wb.fogScoutHeavy ? (
          <div className="text-ink2">Dichter Nebel am Ziel: Aufklärung liefert nur ein grobes Lagebild.</div>
        ) : fog >= wb.fogScoutFrom ? (
          <div className="text-ink2">Nebel am Ziel: Aufklärung liefert nur ein unsicheres Lagebild.</div>
        ) : null}
      </div>
    </div>
  );
}
