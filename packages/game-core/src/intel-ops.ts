// Lagebild Stufe 2 (docs/REGELN-LAGEBILD.md 5.3–5.5, 5.7): Patrouille, Aufklärungskampagne, mobile Radarstation und
// Sonar. Rein und deterministisch; der Server (packages/engine/src/intel-*.ts) und die Oberfläche rechnen damit.
// Positionen und Wegstrecken der Patrouille in Projektions-Kilometern (wie Sensorkreise und Karte).
import type { Counts, ResourceMap, Result } from "./types.ts";
import type { FleetSize, IntelBalance } from "./intel.ts";
import { mulberry32 } from "./rng.ts";

/** Patrouille (5.4). */
export interface PatrolBalance {
  /** Erlaubte Einheiten (Korvette, Zerstörer, U-Boot, Aufklärungsdrohne). */
  units: string[];
  /** Wählbare Dauer auf Station in Stunden. */
  hours: number[];
  minWaypoints: number;
  maxWaypoints: number;
  /** Sichtweite (Erkennung) um die aktuelle Position: Schiffe, Drohnen. */
  shipSightKm: number;
  droneSightKm: number;
  /** Drohnen: höchstens so lange auf Station und so weit bis zum fernsten Wegpunkt. */
  droneMaxHours: number;
  droneMaxRangeKm: number;
  /** Abschuss je Abfangjäger und Drohne in fremder Radarreichweite, höchstens interceptMax. */
  interceptPerFighter: number;
  interceptMax: number;
  /** Prüftakt auf Station (Abfangen, Meldung „Fremde Patrouille gesichtet“) in Minuten. */
  tickMinutes: number;
}

/** Aufklärungskampagne (5.5). */
export interface CampaignBalance {
  maxTargets: number;
  /** Erkennung um die Route jeder Aufklärung (auch mit einem Ziel). */
  revealKm: number;
}

/** Mobile Radarstation (5.3). */
export interface PostBalance {
  /** Besatzung (Einheit, Mindestzahl) und Träger (genau so viele mindestens). */
  crewUnit: string;
  minCrew: number;
  carrier: string;
  minCarriers: number;
  cost: ResourceMap;
  /** Radarstation im Ausgangshafen mindestens auf dieser Stufe. */
  radarLevel: number;
  rangeKm: number;
  /** Treibstoff je Stunde aus dem Hafen des Postens; ohne Treibstoff fällt er aus. */
  fuelPerHour: number;
  /** Höchstzahl je Spieler, mit Hafenkommandantur harborLevel maxHarbor. */
  max: number;
  maxHarbor: number;
  harborLevel: number;
  minDistanceKm: number;
  /** Lebenspunkte der Anlage (fällt mit der Besatzung). */
  hp: number;
  /** Anteil der Kosten, der beim Abbau zurückkommt. */
  refund: number;
}

/** Sonar (5.7): U-Jagd-Einheiten in baseKm + perLevelKm je Stufe Forschung „sonar“; U-Boote auf Patrouille subKm. */
export interface SonarBalance {
  baseKm: number;
  perLevelKm: number;
  subKm: number;
}

/**
 * Bordsicht: jeder Verband auf See sieht um seine aktuelle Position; maßgeblich ist die beste Einheit. Kriegsschiffe
 * warshipKm, Transporter (transports) transportKm, Drohnen (drones) droneKm – alles Erkennung; Flugzeuge aircraftKm
 * nur Sichtung von Verbänden. U-Boote sehen nur U-Boote (Sonar).
 */
export interface FleetSightBalance {
  warshipKm: number;
  transportKm: number;
  droneKm: number;
  aircraftKm: number;
  transports: string[];
  drones: string[];
}

type XY = { x: number; y: number };
type UnitInfo = { branch?: string; submerged?: boolean; attack?: { uboot?: number } } | undefined;
type Defs = Record<string, UnitInfo>;

export const patrolOf = (ib: IntelBalance | undefined): PatrolBalance | null => ib?.patrol ?? null;
export const campaignOf = (ib: IntelBalance | undefined): CampaignBalance | null => ib?.campaign ?? null;
export const postOf = (ib: IntelBalance | undefined): PostBalance | null => ib?.post ?? null;

function active(units: Counts): [string, number][] {
  return Object.entries(units).filter(([, n]) => n > 0);
}

/** Enthält der Verband Aufklärungsdrohnen (Luft)? */
export function hasDrones(units: Counts, defs: Defs): boolean {
  return active(units).some(([id]) => defs[id]?.branch === "luft");
}

/**
 * Prüft eine Patrouille. farthestKm: Entfernung Hafen → fernster Wegpunkt.
 * Codes: patrol_off, patrol_units, patrol_waypoints, patrol_hours, patrol_drone_hours, patrol_drone_range.
 */
export function patrolCheck(units: Counts, hours: number, waypoints: number, farthestKm: number, defs: Defs, pb: PatrolBalance | null): Result<{ drones: boolean }> {
  if (!pb) return { ok: false, code: "patrol_off" };
  const list = active(units);
  if (list.length === 0) return { ok: false, code: "empty_fleet" };
  if (list.some(([id]) => !pb.units.includes(id))) return { ok: false, code: "patrol_units" };
  if (waypoints < pb.minWaypoints || waypoints > pb.maxWaypoints) return { ok: false, code: "patrol_waypoints" };
  if (!pb.hours.includes(hours)) return { ok: false, code: "patrol_hours" };
  const drones = hasDrones(units, defs);
  if (drones && hours > pb.droneMaxHours) return { ok: false, code: "patrol_drone_hours" };
  if (drones && farthestKm > pb.droneMaxRangeKm) return { ok: false, code: "patrol_drone_range" };
  return { ok: true, drones };
}

/** Länge der Runde über alle Wegpunkte und zurück zum ersten (km). */
export function loopLength(points: readonly XY[]): number {
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/** Punkt nach `km` Fahrt auf der Runde ab dem ersten Wegpunkt (die Runde wird im Kreis abgefahren). */
export function pointOnLoop(points: readonly XY[], km: number): XY {
  if (points.length === 0) return { x: 0, y: 0 };
  const total = loopLength(points);
  if (points.length === 1 || total <= 0) return { ...points[0] };
  let rest = ((km % total) + total) % total;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= len) {
      const t = len > 0 ? rest / len : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= len;
  }
  return { ...points[0] };
}

/** Sichtweite (Erkennung) einer Patrouille: Drohnen 200 km, Schiffe über Wasser 100 km, nur U-Boote 0 (nur Sonar). */
export function patrolSightKm(units: Counts, defs: Defs, pb: PatrolBalance): number {
  let km = 0;
  for (const [id] of active(units)) {
    const d = defs[id];
    if (d?.branch === "luft") km = Math.max(km, pb.droneSightKm);
    else if (d?.branch === "see" && !d.submerged) km = Math.max(km, pb.shipSightKm);
  }
  return km;
}

/** Hat der Verband U-Jagd (attack.uboot > 0: Korvette, Zerstörer)? */
export function huntsSubs(units: Counts, defs: Defs): boolean {
  return active(units).some(([id]) => (defs[id]?.attack?.uboot ?? 0) > 0);
}

/**
 * Sonarreichweite eines Verbands oder Hafens: mit U-Jagd baseKm + perLevelKm × Sonar-Stufe; nur U-Boote (auf
 * Patrouille) subKm; sonst 0.
 */
export function sonarKm(units: Counts, defs: Defs, sonarLevel: number, sb: SonarBalance | undefined, onPatrol: boolean): number {
  if (!sb) return 0;
  if (huntsSubs(units, defs)) return sb.baseKm + sb.perLevelKm * Math.max(0, sonarLevel);
  if (onPatrol && active(units).some(([id]) => defs[id]?.submerged)) return sb.subKm;
  return 0;
}

/** Abschusswahrscheinlichkeit je Drohne bei `fighters` Abfangjägern im Hafen. */
export function interceptChance(fighters: number, pb: PatrolBalance): number {
  return Math.max(0, Math.min(pb.interceptMax, fighters * pb.interceptPerFighter));
}

/** Abgeschossene Drohnen: je Drohne ein Wurf mit `chance` (deterministisch über den Seed). */
export function dronesShot(drones: number, chance: number, seed: number): number {
  if (drones <= 0 || chance <= 0) return 0;
  const rng = mulberry32(seed);
  let shot = 0;
  for (let i = 0; i < drones; i++) if (rng() < chance) shot++;
  return shot;
}

/** Höchstzahl Radarposten je Spieler (Hafenkommandantur: höchste Stufe aller eigenen Häfen). */
export function postLimit(harborLevel: number, pb: PostBalance): number {
  return harborLevel >= pb.harborLevel ? pb.maxHarbor : pb.max;
}

/** Rückerstattung beim Abbau (abgerundet). */
export function postRefund(pb: PostBalance): ResourceMap {
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(pb.cost)) out[r] = Math.floor(v * pb.refund);
  return out;
}

/** Verband für einen Radarposten: Besatzung und Träger in Mindestzahl. Codes: post_off, post_crew. */
export function postCrewCheck(units: Counts, pb: PostBalance | null): Result<{ crew: Counts }> {
  if (!pb) return { ok: false, code: "post_off" };
  if ((units[pb.crewUnit] ?? 0) < pb.minCrew || (units[pb.carrier] ?? 0) < pb.minCarriers) return { ok: false, code: "post_crew" };
  return { ok: true, crew: { [pb.crewUnit]: units[pb.crewUnit] } };
}

/** Kampagne: 1 bis maxTargets Ziele, keine doppelten Felder. Codes: campaign_off, campaign_targets. */
export function campaignCheck(targets: readonly { col: number; row: number }[], cb: CampaignBalance | null): Result<object> {
  if (!cb) return { ok: false, code: "campaign_off" };
  if (targets.length < 1 || targets.length > cb.maxTargets) return { ok: false, code: "campaign_targets" };
  const keys = new Set(targets.map((t) => `${t.col},${t.row}`));
  if (keys.size !== targets.length) return { ok: false, code: "campaign_targets" };
  return { ok: true };
}

const SIZES: FleetSize[] = ["klein", "mittel", "gross"];

/**
 * Desinformation (7): gemeldete Größenklasse eine Stufe daneben. Am Rand nach innen, „mittel“ je nach Verband
 * (gerade ID größer, ungerade kleiner) – fest je Verband, damit die Angabe nicht von Abruf zu Abruf springt.
 */
export function disinfoSize(size: FleetSize, fleetId: number): FleetSize {
  const i = SIZES.indexOf(size);
  if (i <= 0) return "mittel";
  if (i >= 2) return "mittel";
  return fleetId % 2 === 0 ? "gross" : "klein";
}

/** Bordsicht eines Verbands: Erkennungsweite (Schiffe, Drohnen) und Sichtungsweite der Flugzeuge (0 = keine). */
export function fleetSightKm(units: Counts, defs: Defs, fs: FleetSightBalance | undefined): { recognizeKm: number; sightKm: number } {
  let recognizeKm = 0;
  let sightKm = 0;
  if (!fs) return { recognizeKm, sightKm };
  for (const [id] of active(units)) {
    const d = defs[id];
    if (fs.drones.includes(id)) recognizeKm = Math.max(recognizeKm, fs.droneKm);
    else if (d?.branch === "luft") sightKm = Math.max(sightKm, fs.aircraftKm);
    else if (d?.branch === "see" && !d.submerged) recognizeKm = Math.max(recognizeKm, fs.transports.includes(id) ? fs.transportKm : fs.warshipKm);
  }
  return { recognizeKm, sightKm };
}
