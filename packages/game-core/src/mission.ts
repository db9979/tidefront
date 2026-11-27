import type {
  Balance,
  BaseState,
  Counts,
  FleetCheck,
  GeoPoint,
  Mission,
  MissionInput,
  MissionRoute,
  MissionType,
  ResourceMap,
  Result,
} from "./types.ts";
import { hasResources, settle, subtractResources } from "./economy.ts";
import { commandPoints, missionSlots } from "./buildings.ts";
import { distanceKm } from "./geo.ts";
import { endBeginnerProtection, protectionStatus, suspendNightShield } from "./protection.ts";
import type { Modifiers } from "./modifiers.ts";
import { modEntry, modValue } from "./modifiers.ts";
import { hexAtLonLat, inGrid, seaRoute, seaRouteCopy } from "@tidefront/world";
import { reconRangeKm, sightTravelSeconds, sightTurn, type SightTurn } from "./recon-sight.ts";

export const MISSION_TYPES: readonly MissionType[] = ["ueberfall", "aufklaerung", "transport"];

/** Mehrere Häfen: Gründung (Kolonieschiff, Geleit kehrt heim) und Verlegung (nur Hinfahrt), nur serverseitig geplant. */
export const EXPANSION_MISSION_TYPES: readonly MissionType[] = ["gruendung", "verlegung"];

/** Missionsarten, die Ladung mitführen dürfen. */
const CARGO_TYPES: readonly string[] = ["transport", "gruendung", "verlegung"];

/** Hin- und Rückweg (REGELN.md, Abschnitt Missionen). */
export const ROUND_TRIP_FACTOR = 2;

function entries(units: Counts): [string, number][] {
  return Object.entries(units).filter(([, n]) => n !== 0);
}

/** Summen eines Verbands: Kommandopunkte, Truppengröße, Truppenraum, Ladekapazität (mal `mods.cargo`). */
export function fleetTotals(units: Counts, balance: Balance, mods?: Modifiers): Omit<FleetCheck, "commandPointsAvailable"> {
  let commandPointsUsed = 0;
  let troopSize = 0;
  let troopSpace = 0;
  let cargoCapacity = 0;
  for (const [id, n] of entries(units)) {
    const def = balance.units[id];
    if (def === undefined) continue;
    commandPointsUsed += (def.commandPoints ?? 0) * n;
    if (def.branch === "land") troopSize += (def.size ?? 0) * n;
    troopSpace += (def.troopSpace ?? 0) * n;
    cargoCapacity += (def.cargo ?? 0) * n;
  }
  return { commandPointsUsed, troopSize, troopSpace, cargoCapacity: cargoCapacity * modValue(mods, "cargo") };
}

/**
 * Prüft einen Verband gegen den Startstützpunkt und die Entfernung.
 * Codes: empty_fleet, unknown_unit, bad_count, units_unavailable, command_points,
 * troop_capacity, no_carrier, out_of_range.
 */
export function validateFleet(
  base: BaseState,
  units: Counts,
  distance: number,
  balance: Balance,
  mods?: Modifiers,
): Result<{ check: FleetCheck }> {
  const list = entries(units);
  if (list.length === 0) return { ok: false, code: "empty_fleet" };
  for (const [id, n] of list) {
    if (!Object.hasOwn(balance.units, id)) return { ok: false, code: "unknown_unit" };
    if (balance.units[id].covert) return { ok: false, code: "covert_unit" };
    if (!Number.isInteger(n) || n < 0) return { ok: false, code: "bad_count" };
    if ((base.units[id] ?? 0) < n) return { ok: false, code: "units_unavailable" };
  }
  const totals = fleetTotals(units, balance, mods);
  const available = commandPoints(base, balance);
  // Kleine Toleranz gegen Gleitkomma-Summen (z. B. 0.15 * 400).
  if (totals.commandPointsUsed > available + 1e-9) return { ok: false, code: "command_points" };
  if (totals.troopSize > totals.troopSpace) return { ok: false, code: "troop_capacity" };
  if (slowestSpeedKmh(units, balance) === null) return { ok: false, code: "no_carrier" };
  for (const [id] of list) {
    const def = balance.units[id];
    if (def.branch === "luft" && distance > (def.rangeKm ?? 0)) return { ok: false, code: "out_of_range" };
  }
  return { ok: true, check: { ...totals, commandPointsAvailable: available } };
}

/**
 * Maßgebliche Geschwindigkeit: das langsamste Schiff; ohne Schiffe das langsamste Flugzeug.
 * null, wenn der Verband weder Schiffe noch Flugzeuge enthält. `mods.speed` je Gattung.
 */
export function slowestSpeedKmh(units: Counts, balance: Balance, mods?: Modifiers): number | null {
  let ship: number | null = null;
  let air: number | null = null;
  for (const [id, n] of entries(units)) {
    const def = balance.units[id];
    if (def === undefined || n <= 0 || def.speedKmh === undefined) continue;
    const v = def.speedKmh * modEntry(mods, "speed", def.branch);
    if (def.branch === "see") ship = ship === null ? v : Math.min(ship, v);
    if (def.branch === "luft") air = air === null ? v : Math.min(air, v);
  }
  return ship ?? air;
}

/** Hat der Verband Schiffe (dann fährt er den Seeweg)? */
export function hasShipUnits(units: Counts, balance: Balance): boolean {
  return Object.entries(units).some(([id, n]) => n > 0 && balance.units[id]?.branch === "see");
}

/**
 * Seewege: Route eines Verbands zwischen zwei Punkten (Feldmittelpunkten). Mit Schiffen die Wegsuche über Wasser
 * (@tidefront/world seaRoute, zwischengespeichert), ohne Schiffe null (Luftlinie). Kopie, darf in den Plan.
 */
export function missionRoute(units: Counts, origin: GeoPoint, target: GeoPoint, balance: Balance): MissionRoute | null {
  if (!hasShipUnits(units, balance)) return null;
  const a = hexAtLonLat(origin.lon, origin.lat);
  const b = hexAtLonLat(target.lon, target.lat);
  if (!inGrid(a.col, a.row) || !inGrid(b.col, b.row)) return null; // außerhalb der Karte (nur Tests): Luftlinie
  return seaRouteCopy(seaRoute(a, b));
}

/** Gefahrene Strecke einer Mission: Länge der Route, sonst die Luftlinie (alte Missionen, reine Luftverbände). */
export function missionTravelKm(m: { distanceKm: number; route?: MissionRoute | null }): number {
  return m.route ? Math.max(m.distanceKm, m.route.km) : m.distanceKm;
}

/** Reisezeit für eine Strecke in Sekunden; null ohne Schiffe und Flugzeuge. */
export function travelSeconds(units: Counts, distance: number, balance: Balance, mods?: Modifiers): number | null {
  const speed = slowestSpeedKmh(units, balance, mods);
  if (speed === null || speed <= 0) return null;
  return (distance / speed) * 3600;
}

/** Treibstoff für Hin- und Rückweg (`trips` Strecken, Vorgabe 2), aufgerundet (`mods.fuel` vor dem Aufrunden). */
export function fuelCost(units: Counts, distance: number, balance: Balance, mods?: Modifiers, trips = ROUND_TRIP_FACTOR): number {
  let sum = 0;
  for (const [id, n] of entries(units)) {
    sum += ((balance.units[id]?.fuelPer100Km ?? 0) * n * distance) / 100;
  }
  // Rundung auf 9 Nachkommastellen vor dem Aufrunden, damit 7.000000000001 nicht 8 kostet.
  return Math.ceil(Math.round(sum * trips * modValue(mods, "fuel") * 1e9) / 1e9);
}

/**
 * Plant eine Mission: prüft Verband, Missionsplatz, Treibstoff und Ladung, zieht Treibstoff
 * (und Transportgut) ab und verschiebt die Einheiten nach unitsAway.
 * Zusätzliche Codes: bad_type, no_mission_slot, target_protected, cargo_not_allowed, bad_cargo,
 * cargo_capacity, fuel, insufficient_resources, storm (reine Luftmission bei Sturm am Start).
 * Mehrere Häfen: „gruendung“ braucht genau ein Kolonieschiff (colony_ship, ohne Balance-Block expansion_off); Treibstoff
 * für das Kolonieschiff nur hin, für das Geleit hin und zurück. „verlegung“ fährt nur hin (Treibstoff einfach,
 * returnAtMs = arriveAtMs). Beide dürfen Ladung bis zur Kapazität mitführen.
 * Wetter (`input.weather`, v1.6): Mit Schiffen verlängert der Sturm entlang der Route die Reisezeit (shipFactor).
 */
export function planMission(
  base: BaseState,
  input: MissionInput,
  nowMs: number,
  balance: Balance,
  mods?: Modifiers,
): Result<{ base: BaseState; mission: Mission }> {
  if (!(MISSION_TYPES as readonly string[]).includes(input.type) && !(EXPANSION_MISSION_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, code: "bad_type" };
  }
  const type = input.type as MissionType;
  const ship = balance.expansion?.colonyShip;
  if (type === "gruendung" && ship === undefined) return { ok: false, code: "expansion_off" };
  if (type === "gruendung" && (input.units[ship!] ?? 0) !== 1) return { ok: false, code: "colony_ship" };
  if (input.activeMissions >= missionSlots(base, balance)) return { ok: false, code: "no_mission_slot" };

  const distance = distanceKm(input.origin, input.target);
  const fleet = validateFleet(base, input.units, distance, balance, mods);
  if (!fleet.ok) return fleet;

  const hasShips = hasShipUnits(input.units, balance);
  if (input.weather?.stormAtOrigin && !hasShips) return { ok: false, code: "storm" };
  // Seewege: mit Schiffen fährt der Verband die Route über Wasser (Fahrzeit und Treibstoff nach ihrer Länge);
  // die Reichweitenprüfung der Flugzeuge oben bleibt bei der Luftlinie (sie fliegen vom Verband aus).
  const route = !hasShips ? null : input.route !== undefined ? input.route : missionRoute(input.units, input.origin, input.target, balance);
  const travelKm = route ? Math.max(distance, route.km) : distance;
  // Aufklärung auf Sicht: Wendepunkt in Lagebild-Reichweite; Fahrt und Treibstoff nur bis dorthin (hin und zurück).
  const sr = input.sightRecon && type === "aufklaerung" ? balance.intel?.sightRecon : undefined;
  const turn = sr ? reconTurn(input, route, balance) : null;
  const tripKm = turn ? Math.min(travelKm, turn.km) : travelKm;

  if (type === "ueberfall" && input.targetProtection !== undefined) {
    if (protectionStatus(input.targetProtection, nowMs, balance).protected) {
      return { ok: false, code: "target_protected" };
    }
  }

  const cargo: ResourceMap = {};
  let cargoTotal = 0;
  for (const [r, amount] of Object.entries(input.cargo ?? {})) {
    if (amount === 0) continue;
    if (!CARGO_TYPES.includes(type)) return { ok: false, code: "cargo_not_allowed" };
    if (!balance.resources.includes(r) || !(amount > 0)) return { ok: false, code: "bad_cargo" };
    cargo[r] = amount;
    cargoTotal += amount;
  }
  if (cargoTotal > fleet.check.cargoCapacity) return { ok: false, code: "cargo_capacity" };

  const next = settle(base, nowMs, balance, mods);
  let fuel: number;
  if (type === "verlegung") fuel = fuelCost(input.units, travelKm, balance, mods, 1);
  else if (type === "gruendung") {
    const { [ship!]: one, ...escort } = input.units;
    fuel = fuelCost(escort, travelKm, balance, mods) + fuelCost({ [ship!]: one }, travelKm, balance, mods, 1);
  } else fuel = fuelCost(input.units, tripKm, balance, mods);
  if ((next.resources.treibstoff ?? 0) < fuel) return { ok: false, code: "fuel" };
  next.resources = subtractResources(next.resources, { treibstoff: fuel });
  if (!hasResources(next.resources, cargo)) return { ok: false, code: "insufficient_resources" };
  next.resources = subtractResources(next.resources, cargo);

  const units: Counts = {};
  for (const [id, n] of entries(input.units)) {
    units[id] = n;
    next.units[id] = (next.units[id] ?? 0) - n;
    next.unitsAway[id] = (next.unitsAway[id] ?? 0) + n;
  }
  if (type === "ueberfall") {
    next.protection = suspendNightShield(next.protection, nowMs, balance);
    // PvP: Überfall auf einen Spielerhafen beendet den eigenen Anfängerschutz (nicht Nester, Felder, Weltereignisse).
    if (input.playerHarbor && balance.pvp?.beginnerEndsOnPlayerRaid) next.protection = endBeginnerProtection(next.protection, nowMs, balance);
  }

  const shipFactor = hasShips && input.weather ? input.weather.shipFactor : 1;
  const rawSeconds = (travelSeconds(input.units, tripKm, balance, mods) ?? 0) * shipFactor;
  const seconds = sr && turn ? sightTravelSeconds(rawSeconds, sr) : rawSeconds;
  const travelMs = Math.ceil(seconds * 1000);
  const mission: Mission = {
    type,
    units,
    origin: { ...input.origin },
    target: { ...input.target },
    distanceKm: distance,
    travelSeconds: seconds,
    fuelCost: fuel,
    cargo,
    departAtMs: nowMs,
    arriveAtMs: nowMs + travelMs,
    returnAtMs: type === "verlegung" ? nowMs + travelMs : nowMs + 2 * travelMs,
    ...(mods?.stealth !== undefined && mods.stealth !== 1 ? { warningFactor: mods.stealth } : {}),
    ...(input.weather ? { weather: { avgWind: input.weather.avgWind, storminess: input.weather.storminess, shipFactor } } : {}),
    ...(route ? { route } : {}),
    ...(turn ? { sightTurn: { ...turn, km: tripKm } } : {}),
  };
  return { ok: true, base: next, mission };
}

/** Wendepunkt einer Aufklärung auf Sicht (Felder aus den Geo-Punkten, Route oder Luftlinie); null = bis ans Ziel. */
function reconTurn(input: MissionInput, route: MissionRoute | null, balance: Balance): SightTurn | null {
  const range = reconRangeKm(input.units, balance.units, balance.intel?.fleetSight);
  return sightTurn(hexAtLonLat(input.origin.lon, input.origin.lat), hexAtLonLat(input.target.lon, input.target.lat), route, range);
}

/**
 * Rückruf auf der Hinfahrt: Der Verband kehrt sofort um und ist nach der bereits gefahrenen Zeit wieder
 * daheim (Rückkehr = jetzt + (jetzt - Abfahrt)). Seewege: Er fährt dasselbe Stück der Route zurück (Position beim
 * Rückruf: Anteil der Fahrzeit auf der Route, siehe engine intel-route.ts fleetPosition). Treibstoff wird nicht erstattet; Transportgut kommt
 * mit zurück (der Aufrufer bucht es bei der Rückkehr über returnMission). Ob die Mission noch auf der
 * Hinfahrt ist und dem Spieler gehört, prüft der Aufrufer.
 * Codes: already_recalled, already_arrived.
 */
export function recallMission(mission: Mission, nowMs: number): Result<{ mission: Mission; returnAtMs: number }> {
  if (mission.recalledAtMs !== undefined) return { ok: false, code: "already_recalled" };
  if (nowMs >= mission.arriveAtMs) return { ok: false, code: "already_arrived" };
  const elapsed = Math.max(0, nowMs - mission.departAtMs);
  const returnAtMs = nowMs + elapsed;
  return {
    ok: true,
    returnAtMs,
    mission: {
      ...mission,
      units: { ...mission.units },
      origin: { ...mission.origin },
      target: { ...mission.target },
      cargo: { ...mission.cargo },
      ...(mission.route ? { route: { ...mission.route, hexes: mission.route.hexes.map(([c, r]) => [c, r] as [number, number]) } } : {}),
      recalledAtMs: nowMs,
      returnAtMs,
    },
  };
}
