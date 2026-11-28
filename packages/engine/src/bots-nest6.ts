// KI bündelt für die Inselfestung (Nest 6, Nutzerentscheid nach v1.35): Ab Saisontag NEST6_FROM_DAY prüft der
// Freibeuter im Heimathafen, ob sein gebündelter Verband – daheim, heimkehrende Überfälle und die Feldbesatzungen
// dieses Hafens, ohne Heimwache außer der Mindestwache – ein bekanntes Nest 6 im Probekampf schafft (über die Würfe im Mittel ≥ 90 %, ungünstig ≥ 50 %,
// nestProbeOk ohne Lagebild). Dann ruft er die Feldbesatzungen des Hafens zurück, startet keine neuen Fahrten aus ihm
// und greift an, sobald der Verband daheim den Probekampf besteht. Danach besetzt fieldTurn die Felder wieder. Bricht
// nach NEST6_BUNDLE_HOURS ab (dann NEST6_PAUSE_HOURS Pause). Saisonlauf v1.35: ohne Bündeln nie ein Sieg über Nest 6.
import { and, eq, inArray } from "drizzle-orm";
import type { BaseState, Counts, Modifiers } from "@tidefront/game-core";
import { LATE_NEST_POINTS, hexAtLonLat, hexDistanceKm } from "@tidefront/world";
import { tables } from "@tidefront/db";
import type { BaseRow } from "./store.ts";
import { runningSeason } from "./season.ts";
import { fieldRecall } from "./fields-missions.ts";
import { botMap } from "./bots-intel.ts";
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
    if (!ok(strikeForce({ ...base.state, units: all.units }, 0, 0))) {
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
  const force = strikeForce(base.state, 0, 0); // alles hinein (nur die Mindestwache von 40 Truppen bleibt)
  if (!ok(force)) return true; // warten, bis alle daheim sind
  const input = { type: "ueberfall", units: force, col: target.col, row: target.row, baseId: base.id };
  const pv = await missionPreview(c.engine, c.bot.id, input);
  if (!pv.ok) c.log.push(`Inselfestung: Fahrt nicht möglich (${(pv as { code?: string }).code ?? "?"}).`);
  const launched = pv.ok && (await tryLaunch(c, input, `Überfall auf die Inselfestung (Stufe 6, ${Math.round(target.d)} km) mit dem gebündelten Verband.`));
  st.nest6Bundle = undefined;
  st.nest6PauseUntil = c.nowMs + NEST6_PAUSE_HOURS * HOUR_MS;
  return launched;
}
