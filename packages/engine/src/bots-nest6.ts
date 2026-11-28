// KI bündelt für die Inselfestung (Nest 6, Nutzerentscheid nach v1.35): Ab Saisontag NEST6_FROM_DAY prüft der
// Freibeuter im Heimathafen, ob sein gebündelter Verband – daheim, heimkehrende Überfälle und die Feldbesatzungen
// dieses Hafens, ohne Heimwache außer der Mindestwache – ein bekanntes Nest 6 im Probekampf schafft (über die Würfe im Mittel ≥ 90 %, ungünstig ≥ 50 %,
// nestProbeOk ohne Lagebild). Dann ruft er die Feldbesatzungen des Hafens zurück, startet keine neuen Fahrten aus ihm
// und greift an, sobald der Verband daheim den Probekampf besteht. Danach besetzt fieldTurn die Felder wieder. Bricht
// nach NEST6_BUNDLE_HOURS ab (dann NEST6_PAUSE_HOURS Pause). Saisonlauf v1.35: ohne Bündeln nie ein Sieg über Nest 6.
import { and, eq, inArray } from "drizzle-orm";
import { commandPoints, fleetTotals, fuelCost, trainingLeft, type BaseState, type Counts, type Modifiers } from "@tidefront/game-core";
import { balance } from "./context.ts";
import { launchMission } from "./commands.ts";
import { LATE_NEST_POINTS, hexAtLonLat, hexDistanceKm } from "@tidefront/world";
import { tables } from "@tidefront/db";
import type { BaseRow } from "./store.ts";
import { runningSeason } from "./season.ts";
import { fieldRecall } from "./fields-missions.ts";
import { botMap } from "./bots-intel.ts";
import { unitValue } from "./scoring.ts";
import { missionPreview } from "./views.ts";
import { nestProbeOk, strikeForce, tryLaunch, type TurnCtx } from "./bots-war.ts";

export const NEST6_FROM_DAY = 35;
export const NEST6_BUNDLE_HOURS = 24;
export const NEST6_PAUSE_HOURS = 12;
/** Probekampf über die Würfe: so viele Läufe mindestens (nestProbeOk prüft Mittel ≥ 90 % und ungünstig ≥ 50 %). */
export const NEST6_PROBE_RUNS = 12;
/** Nest 6 liegt auf fünf abgelegenen Inseln: weiter als die 900 km der übrigen Nestfahrten (Saisonlauf: ≥ 1 600 km vom Freibeuter). */
const RANGE_KM = 2500;
const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/** Die fünf Inselfestungen sind öffentlich (Handbuch nennt die Inseln): auch ohne Lagebild als Stufe 6 bekannt. */
const LATE_SITES = new Set(LATE_NEST_POINTS.map(([lon, lat]) => { const h = hexAtLonLat(lon, lat); return `${h.col},${h.row}`; }));

/** Ohne Flugzeuge, deren Reichweite nicht bis zum Ziel genügt. */
const inRange = (u: Counts, km: number): Counts => Object.fromEntries(Object.entries(u).filter(([id]) => balance.units[id]?.branch !== "luft" || (balance.units[id].rangeKm ?? 0) >= km));

const add = (a: Counts, b: Counts | null | undefined) => { for (const [id, n] of Object.entries(b ?? {})) a[id] = (a[id] ?? 0) + n; return a; };

/** Gebündelter Verband des Hafens: daheim + heimkehrende/auslaufende Überfälle + Feldbesatzungen dieses Hafens. */
async function bundledUnits(c: TurnCtx, base: BaseRow & { state: BaseState }): Promise<{ units: Counts; fields: number[] }> {
  const units: Counts = { ...base.state.units };
  const rows = await c.engine.db.select({ id: tables.mission.id, type: tables.mission.type, status: tables.mission.status, plan: tables.mission.plan, returning: tables.mission.returning })
    .from(tables.mission).where(and(eq(tables.mission.playerId, c.bot.id), eq(tables.mission.baseId, base.id),
      inArray(tables.mission.type, ["ueberfall", "besetzen"]), inArray(tables.mission.status, ["outbound", "returning", "stationed"])));
  for (const r of rows) add(units, (r.status === "outbound" ? (r.plan as { units?: Counts }).units : r.returning) as Counts | null);
  const fields = (await c.engine.db.select({ id: tables.resourceField.id }).from(tables.resourceField)
    .where(and(eq(tables.resourceField.ownerId, c.bot.id), eq(tables.resourceField.baseId, base.id)))).map((f) => f.id);
  return { units, fields };
}

/**
 * Ein Zug des Bündelns für diesen Hafen. Rückgabe true: der Hafen bündelt (keine anderen Fahrten aus ihm in diesem Zug).
 */
export async function nest6Bundle(c: TurnCtx, base: BaseRow & { state: BaseState; isHome?: boolean }, mods: Modifiers): Promise<boolean> {
  if (c.bot.profile !== "freibeuter" || !base.isHome || c.cfg.probeRuns <= 0) return false;
  const st = c.state;
  const active = st.nest6Bundle && st.nest6Bundle.baseId === base.id ? st.nest6Bundle : null;
  if (!active) {
    if ((st.nest6PauseUntil ?? 0) > c.nowMs) return false;
    const season = await runningSeason(c.engine.db);
    if (season && (st.nest6LaunchedAt ?? 0) >= season.startsAt.getTime()) return false; // einmal je Saison, danach wieder Felder
    if (!season || c.nowMs - season.startsAt.getTime() < NEST6_FROM_DAY * DAY_MS * ((season.endsAt.getTime() - season.startsAt.getTime()) / (42 * DAY_MS))) return false;
  }
  const map = await botMap(c);
  const nests = map.nests
    .filter((n) => (n.level === 6 || (n.level === null && LATE_SITES.has(`${n.col},${n.row}`))) && n.empty !== true)
    .map((n) => ({ ...n, d: hexDistanceKm(base, n) }))
    .filter((n) => n.d <= RANGE_KM)
    .sort((a, b) => a.d - b.d);
  const target = (active ? nests.find((n) => n.id === active.nestId) : null) ?? nests[0];
  const runs = Math.max(NEST6_PROBE_RUNS, c.cfg.probeRuns);
  const ok = (units: Counts) => nestProbeOk({ units, modifiers: mods }, { level: 6 }, c.nowMs, runs, c.cfg.probeWinRate);
  if (!target) {
    if (active) { st.nest6Bundle = undefined; st.nest6PauseUntil = c.nowMs + NEST6_PAUSE_HOURS * HOUR_MS; }
    return false;
  }
  if (!active) {
    const all = await bundledUnits(c, base);
    if (!ok(strikeForce({ ...base.state, units: inRange(all.units, target.d) }, 0, 0))) {
      st.nest6PauseUntil = c.nowMs + 3 * HOUR_MS; // nicht jeden Zug neu proben (Pi-Last)
      return false;
    }
    for (const f of all.fields) await fieldRecall(c.engine, c.bot.id, c.key(`nest6-field-${f}`), f).catch(() => null);
    st.nest6Bundle = { baseId: base.id, nestId: target.id, sinceMs: c.nowMs };
    c.log.push(`Bündelt den Verband für die Inselfestung (Stufe 6, ${Math.round(target.d)} km): ${all.fields.length} Feldbesatzungen zurückgerufen.`);
    return true;
  }
  if (c.nowMs - active.sinceMs > NEST6_BUNDLE_HOURS * HOUR_MS) {
    st.nest6Bundle = undefined;
    st.nest6PauseUntil = c.nowMs + NEST6_PAUSE_HOURS * HOUR_MS;
    c.log.push("Bündeln für die Inselfestung abgebrochen (Verband nicht rechtzeitig daheim).");
    return false;
  }
  // Alles hinein (nur die Mindestwache von 40 Truppen bleibt); Flugzeuge reichen nicht bis zu den Inseln.
  const force = strikeForce({ ...base.state, units: inRange(base.state.units, target.d) }, 0, 0);
  if (!ok(force)) return true; // warten, bis alle daheim sind
  const input = { type: "ueberfall", units: force, col: target.col, row: target.row, baseId: base.id };
  const pv = await missionPreview(c.engine, c.bot.id, input);
  if (!pv.ok) c.log.push(`Inselfestung: Fahrt nicht möglich (${(pv as { code?: string }).code ?? "?"}).`);
  const launched = pv.ok && (await tryLaunch(c, input, `Überfall auf die Inselfestung (Stufe 6, ${Math.round(target.d)} km) mit dem gebündelten Verband.`));
  if (launched) st.nest6LaunchedAt = c.nowMs;
  st.nest6Bundle = undefined;
  st.nest6PauseUntil = c.nowMs + NEST6_PAUSE_HOURS * HOUR_MS;
  return launched;
}

// ---------------------------------------------------------------- Rüstungsplan „Truppen für Nest 6 ab Tag 30“ (v1.37)

/** Ab diesem Saisontag spart der Freibeuter im Heimathafen Truppen und Schiffe für Nest 6. */
export const NEST6_PREP_FROM_DAY = 30;
/**
 * Verband, der Nest 6 laut sim/nest6.ts sicher schlägt (Bot-Verband Tag 38 mit zwei Landungsschiffen mehr, etwas Puffer
 * für Wurf und Erholung). So viel hält der Freibeuter ab Tag 30 daheim (Nestfahrten nehmen nur den Überschuss), und die
 * Ausbildung füllt die Lücken zuerst auf.
 */
export const NEST6_PACKAGE: Counts = { schuetzen: 720, pioniere: 40, kampfpanzer: 20, korvette: 45, zerstoerer: 12, landungsschiff: 10 };

/**
 * Paket für diesen Hafen: NEST6_PACKAGE (≈ 427 KP; ohne Modifikatoren gegen den ungünstigsten Wurf 75 %, über die Würfe
 * 100 %; ohne Flugzeuge, denn die Inseln liegen weit außerhalb ihrer Reichweite von 500–600 km), bei weniger
 * Kommandopunkten anteilig kleiner – Forschung und Veteranen gleichen den Rest meist aus; der Probekampf entscheidet.
 */
export function nest6PackageFor(state: BaseState): Counts {
  if (!state.buildings) return NEST6_PACKAGE;
  const cap = commandPoints(state, balance);
  const need = fleetTotals(NEST6_PACKAGE, balance).commandPointsUsed;
  if (need <= cap) return NEST6_PACKAGE;
  return Object.fromEntries(Object.entries(NEST6_PACKAGE).map(([id, n]) => [id, Math.floor((n * cap) / need)]));
}

/** Rüstungsplan aktiv? Freibeuter, Heimathafen, Saisontag 30 bis zum Ende des Fensters (41). */
export async function nest6PrepActive(c: TurnCtx, base: { isHome?: boolean }): Promise<boolean> {
  if (c.bot.profile !== "freibeuter" || !base.isHome) return false;
  const season = await runningSeason(c.engine.db);
  if (!season) return false;
  if ((c.state.nest6LaunchedAt ?? 0) >= season.startsAt.getTime()) return false; // nach dem Angriff: Felder wieder besetzen
  const scale = (season.endsAt.getTime() - season.startsAt.getTime()) / (42 * DAY_MS);
  const day = (c.nowMs - season.startsAt.getTime()) / (DAY_MS * scale);
  return day >= NEST6_PREP_FROM_DAY && day < 41;
}

/** Fehlende Einheiten zum Paket (Bestand daheim, unterwegs und in Ausbildung zählen). */
export function nest6Deficit(state: BaseState): Counts {
  const have: Counts = { ...state.units };
  add(have, state.unitsAway as Counts | undefined);
  for (const o of state.trainingQueue ?? []) if (o.kind === "unit") have[o.id] = (have[o.id] ?? 0) + trainingLeft(o);
  const out: Counts = {};
  for (const [id, n] of Object.entries(nest6PackageFor(state))) if ((have[id] ?? 0) < n) out[id] = n - (have[id] ?? 0);
  return out;
}

/** Zusatzanteile der Doktrin nach Lücke (Wert), damit die Ausbildung das Paket zuerst auffüllt. */
export function nest6DoctrineBoost(state: BaseState): Counts {
  const d = nest6Deficit(state);
  const val = Object.fromEntries(Object.entries(d).map(([id, n]) => [id, n * unitValue(id)]));
  const sum = Object.values(val).reduce((a, b) => a + b, 0);
  if (sum <= 0) return {};
  return Object.fromEntries(Object.entries(val).map(([id, v]) => [id, (v / sum) * 1.5]));
}

/** Verband für andere Fahrten während des Rüstungsplans: nur, was daheim über das Paket hinaus liegt. */
export function withoutNest6Hold(c: TurnCtx, base: { id: number; state: BaseState }, force: Counts): Counts {
  if (!c.nest6Hold || c.nest6Hold !== base.id) return force;
  const out: Counts = {};
  const pkg = nest6PackageFor(base.state);
  for (const [id, n] of Object.entries(force)) {
    const k = Math.min(n, Math.max(0, (base.state.units[id] ?? 0) - (pkg[id] ?? 0)));
    if (k > 0) out[id] = k;
  }
  return out;
}

/** Schiffe, die der Freibeuter für Kommandopunkte in eine Kolonie verlegt (Truppen und Flugzeuge bleiben). */
const SURPLUS_SHIPS = ["korvette", "landungsschiff", "uboot", "minenleger", "zerstoerer", "aufklaerungsdrohne"];
/** Flugzeuge zählen gegen die Kommandopunkte, reichen aber nicht bis zu den Inseln: mit verlegen, wenn die Kolonie Platz hat. */
const SURPLUS_AIR = ["jagdbomber", "abfangjaeger"];

/**
 * Kommandopunkte freimachen: Ist der Hafen voll (Bestand, unterwegs, Ausbildung) und fehlt dem Paket noch etwas, verlegt
 * der Freibeuter überzählige Schiffe in die Kolonie mit den meisten freien Kommandopunkten – sonst ließe die Grenze
 * keine Ausbildung zu (Saisonlauf: 579 von 480 KP belegt, 290 statt 520 Schützen). Höchstens alle 12 h.
 */
export async function nest6FreeCommandPoints(
  c: TurnCtx, home: BaseRow & { state: BaseState }, colonies: (BaseRow & { state: BaseState })[],
): Promise<boolean> {
  if (Object.keys(nest6Deficit(home.state)).length === 0 || colonies.length === 0) return false;
  if (c.nowMs - (c.state.nest6TransferAt ?? 0) < 12 * HOUR_MS) return false;
  const all: Counts = { ...home.state.units };
  add(all, home.state.unitsAway as Counts | undefined);
  for (const o of home.state.trainingQueue ?? []) if (o.kind === "unit") all[o.id] = (all[o.id] ?? 0) + trainingLeft(o);
  const cap = commandPoints(home.state, balance);
  const used = fleetTotals(all, balance).commandPointsUsed;
  const need = fleetTotals(nest6Deficit(home.state), balance).commandPointsUsed;
  if (used + need <= cap) return false;
  const pkg = nest6PackageFor(home.state);
  const pick = (ids: string[]) => {
    const u: Counts = {};
    for (const id of ids) { const n = Math.max(0, (home.state.units[id] ?? 0) - (pkg[id] ?? 0)); if (n > 0) u[id] = n; }
    return u;
  };
  c.state.nest6TransferAt = c.nowMs;
  const free = (b: BaseRow & { state: BaseState }) => commandPoints(b.state, balance) - fleetTotals(b.state.units, balance).commandPointsUsed;
  const target = [...colonies].sort((a, b) => free(b) - free(a))[0];
  for (const units of [pick([...SURPLUS_SHIPS, ...SURPLUS_AIR]), pick(SURPLUS_SHIPS)]) {
    if (Object.keys(units).length === 0) continue;
    const r = await launchMission(c.engine, c.bot.id, c.key(`nest6-transfer-${Object.keys(units).length}`), { type: "verlegung", units, col: target.col, row: target.row, baseId: home.id });
    if (r.ok) { c.log.push(`Verlegt überzählige Schiffe und Flugzeuge nach ${target.name}, um Platz für den Verband gegen die Inselfestung zu schaffen.`); return true; }
  }
  // Nichts Überzähliges daheim: Feldbesatzungen des Hafens heimholen (sie zählen gegen die Kommandopunkte); ihre
  // Schiffe verlegt der nächste Lauf, falls sie über dem Paket liegen.
  const fields = (await c.engine.db.select({ id: tables.resourceField.id }).from(tables.resourceField)
    .where(and(eq(tables.resourceField.ownerId, c.bot.id), eq(tables.resourceField.baseId, home.id)))).map((f) => f.id);
  for (const f of fields) await fieldRecall(c.engine, c.bot.id, c.key(`nest6-cp-field-${f}`), f).catch(() => null);
  if (fields.length > 0) c.log.push(`Holt ${fields.length} Feldbesatzungen heim (Kommandopunkte für die Inselfestung).`);
  return fields.length > 0;
}

/**
 * Treibstoff für die Fahrt zur nächsten Inselfestung samt Rückweg (Seeweg grob × 1,4 der Luftlinie, Paket des Hafens):
 * Rücklage im Rüstungsplan – die Ausbildung nimmt ihn nicht, die Börse verkauft ihn nicht und kauft fehlenden zu
 * (Saisonlauf: der gebündelte Verband scheiterte zuerst an „fuel“). 0 ohne Insel in Reichweite.
 */
export function nest6FuelNeed(base: { col: number; row: number; state: BaseState }, mods?: Modifiers): number {
  let d = Infinity;
  for (const k of LATE_SITES) { const [col, row] = k.split(",").map(Number); d = Math.min(d, hexDistanceKm(base, { col, row })); }
  if (!(d <= RANGE_KM)) return 0;
  return fuelCost(nest6PackageFor(base.state), d * 1.4, balance, mods);
}
