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
    live.powerShort = !!g.fuelLimited && g.throttle < 0.5;
  } else if (id === "radarstation") {
    live.producing = true;
    live.powerShort = g.served.radar < 0.999;
  } else if (id === "elektrolyse") {
    live.producing = (g.surplus?.fuel ?? 0) >= 0.5; // Ökostrom-Überschuss fließt in die Elektrolyse
  } else if (id === "seekabel") {
    live.producing = (g.surplus?.cable ?? 0) >= 0.5 || (base.grid.now.supply?.cable ?? 0) >= 0.5; // sendet oder empfängt
  } else if (id === "startrampe") {
    // Lagebild Stufe 3: Warnlicht, solange ein eigener Satellit fliegt; Dampf bis 30 min nach dem Start.
    const sats = base.satellites ?? [];
    live.producing = sats.some((x) => x.expiresAtMs > now);
    live.launch = sats.some((x) => now - x.launchedAtMs >= 0 && now - x.launchedAtMs < 30 * 60000);
  } else if (id === "stoersender") {
    live.producing = g.served.radar >= 0.999; // Störsender teilt den Rang des Radars
    live.powerShort = g.served.radar < 0.999;
  } else if (id === "speicherwerk") {
    live.fill = g.capacity > 0 ? g.stored / g.capacity : 0;
  }
  return live;
}
