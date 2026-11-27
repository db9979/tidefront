// Lagebild (docs/REGELN-LAGEBILD.md, Stufe 1): Sensoren, Kenntnisstufen, Alter des Wissens. Rein und deterministisch;
// Server (Sicht je Spieler/Allianz) und Oberfläche (Kartennebel, Sensorgrenzen) rechnen mit denselben Funktionen.
// Abstände in Projektions-Kilometern (hexCenterXY), damit der Server dieselben Kreise prüft, die die Karte zeichnet.

/** Balance-Block `intel` (seit v1.17); fehlt er, gibt es keinen Kartennebel (alle sehen alles). */
export interface IntelBalance {
  /** Ausguck jedes Hafens: Sichtweite in km, Stufe Erkennung, ohne Strom. */
  lookoutKm: number;
  /** Radarstation: Grundreichweite plus je Stufe (Stufe 10: 150 + 400 = 550 km). */
  radarBaseKm: number;
  radarKmPerLevel: number;
  /** Reichweitenfaktor bei Strommangel (Radar nicht voll versorgt). */
  radarPowerShortageFactor: number;
  /** Bis hier gilt Wissen als „bekannt“, danach „veraltet“ (Stunden). */
  staleHours: number;
  /** Danach ist es vergessen; das Objekt fällt auf „immer sichtbar“ zurück (Stunden). */
  forgetHours: number;
  /** Verbände auf See: letzte Sichtung bleibt so lange auf der Karte (Stunden). */
  fleetMemoryHours: number;
  /** Sicht je Spieler bzw. Allianz wird so lange zwischengespeichert (Sekunden). */
  cacheSeconds: number;
  /** Größenklassen der Verbände: klein bis smallMax Einheiten, mittel bis mediumMax, groß darüber. */
  sizeSmallMax: number;
  sizeMediumMax: number;
  /** Erkennung rundet Einheiten auf diese Schritte (Einheiten, Anlagen). */
  roundUnits: number;
  roundDefenses: number;
  /** Stufe 2 (seit v1.20, intel-ops.ts): Patrouille, Kampagne, mobile Radarstation, Sonar; fehlt ein Teil, gibt es ihn nicht. */
  patrol?: import("./intel-ops.ts").PatrolBalance;
  campaign?: import("./intel-ops.ts").CampaignBalance;
  post?: import("./intel-ops.ts").PostBalance;
  sonar?: import("./intel-ops.ts").SonarBalance;
  /** Bordsicht (Entscheidung 27.11.2026): jeder eigene Verband auf See sieht um seine Position. */
  fleetSight?: import("./intel-ops.ts").FleetSightBalance;
  /** Stufe 3 (seit v1.23, intel-sat.ts): Satelliten und Gegenmittel; fehlt ein Teil, gibt es ihn nicht. */
  satellite?: import("./intel-sat.ts").SatelliteBalance;
  counter?: import("./intel-sat.ts").CounterBalance;
}

export type IntelLevel = "sichtung" | "erkennung" | "lagebild";
/**
 * Sensorarten: Ausguck und Radar (Häfen), Posten (mobile Radarstation, wie Radar), Patrouille und Aufklärer (Verbände
 * auf See, Erkennung), Sonar (sieht nur getauchte U-Boote, sonst nichts).
 */
export type SensorKind = "ausguck" | "radar" | "posten" | "patrouille" | "aufklaerer" | "sonar" | "verband" | "flug"
  // Stufe 3: Satellitenstreifen (optisch: Erkennung, nicht durch Wolken; Radar: Sichtung, durch Wolken und Nebel).
  | "satellit" | "radarsatellit";
export type FleetSize = "klein" | "mittel" | "gross";
/** Alter einer Angabe: live (jetzt im Sensorbereich), bekannt (< staleHours), veraltet (< forgetHours). */
export type IntelAge = "live" | "bekannt" | "veraltet";

const RANK: Record<IntelLevel, number> = { sichtung: 1, erkennung: 2, lagebild: 3 };

/** Höhere von zwei Kenntnisstufen (null = nichts). */
export function maxLevel(a: IntelLevel | null, b: IntelLevel | null): IntelLevel | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/** Reicht die Stufe `have` mindestens bis `need`? */
export function atLeast(have: IntelLevel | null | undefined, need: IntelLevel): boolean {
  return !!have && RANK[have] >= RANK[need];
}

/** Zustand der Radarstation, der die Reichweite bestimmt. */
export interface RadarCondition {
  /** Versorgter Stromanteil des Radars (1 = voll). */
  powerServed: number;
  /** Nebelfaktor am Hafen (1 = klar, bis 1 − fogRadarMax), wie bei der Vorwarnzeit. */
  fogFactor: number;
  /** Laufende Sabotage der Radarstation: keine Reichweite. */
  sabotaged: boolean;
}

/** Radarreichweite in km: (Grund + je Stufe) × Strom (Mangel: halbe Reichweite) × Nebel; Sabotage oder Stufe 0: 0. */
export function radarRangeKm(level: number, ib: IntelBalance, c: RadarCondition): number {
  if (level < 1 || c.sabotaged) return 0;
  const power = c.powerServed >= 0.999 ? 1 : ib.radarPowerShortageFactor;
  return (ib.radarBaseKm + ib.radarKmPerLevel * level) * power * Math.max(0, Math.min(1, c.fogFactor));
}

/** Ein Sensorkreis (Mittelpunkt in Projektions-km) oder ein Satellitenstreifen (strip; x/y/km dann ohne Bedeutung). */
export interface SensorCircle {
  kind: SensorKind;
  x: number;
  y: number;
  km: number;
  /** Stufe 3: Nord-Süd-Streifen eines Satelliten (x0 … x1 über die ganze Kartenhöhe); blocked: Punkt unter Wolken. */
  strip?: { x0: number; x1: number; blocked?: (x: number, y: number) => boolean };
}

/** Radarartige Sensoren (Störsender und Funkdisziplin mindern ihre Reichweite). */
export const RADAR_KINDS: ReadonlySet<SensorKind> = new Set<SensorKind>(["radar", "posten", "radarsatellit"]);

/**
 * Stufe 3: Gegenmittel am Ziel. camouflaged: Tarnnetz – Ausguck und optischer Satellit erkennen nur Sichtung.
 * radarFactor: Faktor auf radarartige Sensoren (Störsender in der Nähe, Admiral mit Funkdisziplin).
 * sightFactor: Faktor auf alle Sensoren (Tarnanstrich bei Verbänden nur aus Flugzeugen).
 */
export interface TargetMods {
  camouflaged?: boolean;
  radarFactor?: number;
  sightFactor?: number;
}

/** Liegt der Punkt im (um `factor` um die Mitte verschmälerten) Streifen? */
function inStrip(st: NonNullable<SensorCircle["strip"]>, x: number, factor: number): boolean {
  const mid = (st.x0 + st.x1) / 2;
  const half = ((st.x1 - st.x0) / 2) * factor;
  return x >= mid - half && x <= mid + half;
}

/**
 * Kenntnisstufe, mit der die Sensoren einen Punkt jetzt erfassen (null = außerhalb jeder Sicht).
 * Ausguck, Patrouille, Aufklärer: Erkennung für alles. Radar und Posten: Erkennung für Objekte (Häfen, Nester, Felder,
 * Wracks), Sichtung für Verbände. Getauchte U-Boote („submarine“) erfasst nur das Sonar (Erkennung); das Sonar
 * erfasst sonst nichts. Bordsicht: „verband“ (Schiffe, Drohnen) Erkennung, „flug“ (Jäger, Bomber) nur Sichtung von
 * Verbänden – Objekte erfasst ein Flug nicht (ihre Position ist ohnehin bekannt).
 * Stufe 3: Optischer Satellit Erkennung im Streifen außer unter Wolken (strip.blocked), Radarsatellit nur Sichtung.
 * Gegenmittel (mods): Tarnnetz senkt Ausguck und optischen Satelliten auf Sichtung; Faktoren verkürzen Reichweiten
 * (beim Streifen die Breite um die Mitte).
 */
export function liveLevelAt(sensors: readonly SensorCircle[], x: number, y: number, target: "object" | "fleet" | "submarine", mods?: TargetMods): IntelLevel | null {
  let best: IntelLevel | null = null;
  const radarF = mods?.radarFactor ?? 1;
  const sightF = mods?.sightFactor ?? 1;
  for (const s of sensors) {
    if ((s.kind === "sonar") !== (target === "submarine")) continue;
    if (s.kind === "flug" && target !== "fleet") continue;
    const f = sightF * (RADAR_KINDS.has(s.kind) ? radarF : 1);
    if (s.strip) {
      if (!inStrip(s.strip, x, f)) continue;
      if (s.kind === "satellit" && s.strip.blocked?.(x, y)) continue;
    } else {
      const km = s.km * f;
      const dx = s.x - x;
      const dy = s.y - y;
      if (dx * dx + dy * dy > km * km) continue;
    }
    let lvl: IntelLevel = (s.kind === "radar" || s.kind === "posten" || s.kind === "flug") && target === "fleet" ? "sichtung" : "erkennung";
    if (s.kind === "radarsatellit") lvl = "sichtung";
    if (mods?.camouflaged && (s.kind === "ausguck" || s.kind === "satellit")) lvl = "sichtung";
    best = maxLevel(best, lvl);
    if (best === "erkennung") return best;
  }
  return best;
}

/** Größenklasse eines Verbands nach der Zahl sichtbarer Einheiten. */
export function fleetSize(units: number, ib: IntelBalance): FleetSize {
  if (units <= ib.sizeSmallMax) return "klein";
  if (units <= ib.sizeMediumMax) return "mittel";
  return "gross";
}

/** Einheiten, die Radar und Ausguck sehen: ohne getauchte (U-Boote) und verdeckte (Spione). */
export function visibleUnitCount(units: Record<string, number>, defs: Record<string, { submerged?: boolean; covert?: boolean } | undefined>): number {
  let n = 0;
  for (const [id, c] of Object.entries(units)) {
    const d = defs[id];
    if (c > 0 && !d?.submerged && !d?.covert) n += c;
  }
  return n;
}

/** Alter einer gespeicherten Angabe; null = vergessen (älter als forgetHours). */
export function intelAge(seenAtMs: number, nowMs: number, ib: IntelBalance): Exclude<IntelAge, "live"> | null {
  const h = (nowMs - seenAtMs) / 3600000;
  if (h < ib.staleHours) return "bekannt";
  if (h < ib.forgetHours) return "veraltet";
  return null;
}

/** Angabe gerundet wie bei der Erkennung (auf `step`, mindestens step, 0 bleibt 0). */
export function roundForRecognition(n: number, step: number): number {
  if (n <= 0 || step <= 1) return Math.max(0, Math.round(n));
  return Math.max(step, Math.round(n / step) * step);
}

/** Einheitenliste gerundet für die Erkennung. */
export function roundCounts(units: Record<string, number>, step: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(units)) if (n > 0) out[id] = roundForRecognition(n, step);
  return out;
}

/** Kurs in Grad (0 = Nord, 90 = Ost) von a nach b in Projektions-km (y nach Süden). */
export function headingDeg(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const deg = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
  return Math.round((deg + 360) % 360);
}
