// Spielzustand → Bewegung der Gebäudebilder (building-art/motion.tsx). Nur Daten der vorhandenen Basis-Abfrage
// (base.grid: Strom jetzt mit Wetter am Hafen, Bau- und Ausbildungsschlange, Sabotage); kein eigener Serveraufruf.
import type { BaseData } from "./trpc.ts";
import type { Live } from "../building-art/index.tsx";

/** Gebäude, deren Arbeit an der Stromversorgung der Produktion hängt (Rauch, Fackel, LEDs). */
const PRODUCERS = new Set(["stahlwerk", "raffinerie", "chipfabrik", "versorgungshof"]);

/** Wetter am Hafen aus der Stromübersicht (ohne Wettermodell: leer → ruhende Bilder). */
export function harborWeather(base: BaseData): Pick<Live, "wind" | "daylight" | "clouds"> {
  const w = base.grid.now.weather;
  return w ? { wind: w.wind, daylight: w.daylight, clouds: w.clouds } : {};
}

/** Live-Zustand eines Gebäudes für BuildingArt. windCut: Abschaltwind der Windparks (Balance). */
export function buildingLive(base: BaseData, id: string, level: number, now: number, windCut?: number): Live {
  const g = base.grid.now;
  const s = base.intel?.sabotage;
  const disabled = !!s && s.target === id && s.untilMs > now;
  const live: Live = {
    ...harborWeather(base),
    windCut,
    disabled,
    building: base.buildQueue.some((o) => o.buildingId === id && o.startedAt <= now && o.finishesAt > now),
    training: base.trainingQueue.some((o) => o.builtIn === id && o.startedAt <= now),
  };
  if (level <= 0) return live;
  if (PRODUCERS.has(id)) {
    live.producing = g.served.production > 0.01;
    live.powerShort = g.served.production < 0.999;
  } else if (id === "kraftwerk") {
    live.producing = g.supply.kraftwerk > 0.01;
    live.powerShort = g.throttle < 0.5;
  } else if (id === "radarstation") {
    live.producing = true;
    live.powerShort = g.served.radar < 0.999;
  } else if (id === "speicherwerk") {
    live.fill = g.capacity > 0 ? g.stored / g.capacity : 0;
  }
  return live;
}
