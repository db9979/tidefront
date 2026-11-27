// Wetter in der Missionsplanung (v1.6, v1.9): Wind auf der Route bei Abfahrt (Zeitzuschlag, Startverbot) und das
// Wetter am Ziel zur voraussichtlichen Ankunft (Nebel → Aufklärung, Sturm → Flugzeuge, Wolken → Luftschlag).
// Alle Schwellen aus balance.weather. v1.18: Das Wetter am Ziel ist eine Vorhersage mit Spannbreite (von–bis);
// bei Ankunft gilt das tatsächliche Wetter. Das Routenwetter bei Abfahrt ist gemessen und gilt so.
import { BEAUFORT_WORDS, beaufort, stormShare, type RouteWeather as RouteWeatherData, type WeatherBalance } from "@tidefront/game-core";
import { Icon } from "../icons.tsx";
import { fmtTime } from "../lib/time.ts";

/** `factor`: tatsächlicher Zuschlag auf die Reisezeit (1 ohne Schiffe oder ohne Sturm). */
export function RouteWeather({ w, wb, factor }: { w: RouteWeatherData; wb: WeatherBalance; factor?: number }) {
  const t = w.atTarget;
  const fog = t ? t.fog : w.avgFog;
  const icon = w.stormAtOrigin || w.maxWind >= wb.stormFrom ? "sturm" : fog >= wb.fogScoutFrom ? "nebel" : w.avgClouds >= 0.55 ? "wolke" : w.avgWind >= wb.shipSlowFrom ? "wind" : "sonne";
  const f = factor ?? 1;
  const fc = t?.forecast;
  const air = t ? Math.round(wb.airStormPenalty * stormShare(t.wind, wb) * 100) : 0;
  const strike = t ? Math.round(wb.cloudStrikePenalty * t.clouds * 100) : 0;
  // Spannbreite der Wirkung (aus der Spannbreite von Wind und Wolken); ohne Vorhersage wie der Mittelwert.
  const airLo = fc ? Math.round(wb.airStormPenalty * stormShare(fc.wind[0], wb) * 100) : air;
  const airHi = fc ? Math.round(wb.airStormPenalty * stormShare(fc.wind[1], wb) * 100) : air;
  const strikeLo = fc ? Math.round(wb.cloudStrikePenalty * fc.clouds[0] * 100) : strike;
  const strikeHi = fc ? Math.round(wb.cloudStrikePenalty * fc.clouds[1] * 100) : strike;
  const span = (a: number, b: number, unit = "") => (a === b ? `${a}${unit}` : `${a}–${b}${unit}`);
  const pctR = (r: [number, number]) => span(Math.round(r[0] * 100), Math.round(r[1] * 100), " %");
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
            <div className="font-display uppercase tracking-wider text-[10.5px] text-ink2 mt-1.5">
              {fc ? "Vorhersage am Ziel" : "Am Ziel"} bei Ankunft ({fmtTime(t.atMs)})
            </div>
            {fc ? (
              <div className="mono" data-testid="ziel-vorhersage">
                Wind {span(beaufort(fc.wind[0]), beaufort(fc.wind[1]))} Bft · Wolken {pctR(fc.clouds)} · Nebel {pctR(fc.fog)}
              </div>
            ) : (
              <div className="mono">Wind {beaufort(t.wind)} Bft · Wolken {Math.round(t.clouds * 100)} % · Nebel {Math.round(t.fog * 100)} %</div>
            )}
            {t.storm ? (
              <div className="text-siegel">Sturm am Ziel erwartet.</div>
            ) : fc?.stormPossible ? (
              <div className="text-siegel">Sturm am Ziel möglich.</div>
            ) : null}
            {airHi > 0 && <div className={t.storm ? "text-siegel" : "text-ink2"}>Flugzeuge kämpfen schwächer (−{span(airLo, airHi)} %).</div>}
            {strikeHi >= 1 && <div className="text-ink2">Wolken: Luftschlag der Bomber −{span(strikeLo, strikeHi)} %.</div>}
            {fc && <div className="text-[10.5px] text-ink2">Je weiter voraus, desto unsicherer; bei Ankunft gilt das tatsächliche Wetter.</div>}
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
