// Lagebild Stufe 3 (docs/REGELN-LAGEBILD.md 5.6): Satelliten. Start von der Startrampe (Befehl intel.launchSatellite),
// Zustand im Hafen (state.satellites), Überflug alle periodHours als Ereignis satellite_pass (schreibt das Wissen der
// Partei für alles im Streifen, intel-sat-pass.ts), Ende nach lifetimeHours (satellite_end, Abschlussbericht).
// Live ist der Streifen liveMinutes ab Beginn des Überflugs: als Sensor mit Streifen in der Sicht (intel-sight.ts).
// Optisch: Felder mit Bewölkung über cloudMax (echtes Wetter zum Überflug) bleiben verdeckt; Radar: durch Wolken.
import { lockPlayerWide } from "./world-lock.ts";
import {
  activeSatellites, currentPass, hasResources, newSatellite, nextPass, satelliteCost, satelliteLaunchCheck, satelliteLimit, satelliteOf, satPassCount,
  settle, subtractResources, techLevel, weatherAt,
  type BaseState, type IntelBalance, type SatelliteState, type SatelliteType, type SatPass, type SensorCircle,
} from "@tidefront/game-core";
import { COLS, ROWS, HEX_W, KM_PER_DEG_LON, LON0, MAP_LABELS, hexAtXY, hexCenter, hexCenterXY } from "@tidefront/world";
import { and, inArray, sql } from "drizzle-orm";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, GameError, type Engine, type NoticeJob } from "./context.ts";
import { runCommand } from "./commands.ts";
import { basesOfPlayer, homeBaseOf, lockOwnBase, saveBase, scheduleEvent } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { pushNotice, storeNavalReport } from "./naval-common.ts";

/** Kartenbreite in Projektions-km (ungerade Zeilen um ein halbes Feld eingerückt). */
export const MAP_WIDTH_KM = (COLS + 0.5) * HEX_W;

export const SAT_NAME: Record<SatelliteType, string> = { optisch: "Optischer Satellit", radar: "Radarsatellit" };

export function satRules() {
  return satelliteOf(balance.intel);
}

/** „über Nordsee, Frankreich (2° W – 6° O)“: bis zu drei Beschriftungen im Streifen (größte zuerst) und Längengrade. */
export function stripPlace(x0: number, x1: number): string {
  const lon = (x: number) => LON0 + x / KM_PER_DEG_LON;
  const deg = (l: number) => `${Math.abs(Math.round(l))}° ${l < 0 ? "W" : "O"}`;
  const names = MAP_LABELS
    .filter((l) => { const x = (l.lon - LON0) * KM_PER_DEG_LON; return x >= x0 && x <= x1; })
    .sort((a, b) => b.size - a.size)
    .slice(0, 3)
    .map((l) => l.name);
  return `${names.length ? `${names.join(", ")} ` : ""}(${deg(lon(x0))} – ${deg(lon(x1))})`;
}

/** Bewölkung zum Überflug: verdeckt ein Feld für den optischen Satelliten? (je Feld einmal gerechnet) */
export function cloudBlocker(startMs: number, cloudMax: number | undefined): ((x: number, y: number) => boolean) | undefined {
  const wb = balance.weather;
  if (!wb || cloudMax === undefined) return undefined;
  const memo = new Map<number, boolean>();
  return (x, y) => {
    const h = hexAtXY(x, y);
    const k = h.row * 100000 + h.col;
    let v = memo.get(k);
    if (v === undefined) {
      v = weatherAt(hexCenter(h.col, h.row), startMs, wb).clouds > cloudMax;
      memo.set(k, v);
    }
    return v;
  };
}

/** Sensor eines Überflugs (Streifen; optisch mit Wolken zum Beginn des Überflugs). */
export function passSensor(s: SatelliteState, p: SatPass): SensorCircle {
  const def = satRules()?.types[s.type];
  return {
    kind: s.type === "optisch" ? "satellit" : "radarsatellit", x: (p.x0 + p.x1) / 2, y: 0, km: 0,
    strip: { x0: p.x0, x1: p.x1, blocked: s.type === "optisch" ? cloudBlocker(p.startMs, def?.cloudMax) : undefined },
  };
}

/** Unter Wolken verdeckte Felder eines optischen Streifens (für den Kartennebel der Oberfläche); sonst leer. */
export function stripCells(s: SensorCircle): [number, number][] {
  const st = s.strip;
  if (!st?.blocked) return [];
  const out: [number, number][] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = Math.max(0, Math.floor(st.x0 / HEX_W) - 1); col <= Math.min(COLS - 1, Math.ceil(st.x1 / HEX_W)); col++) {
      const p = hexCenterXY(col, row);
      if (p.x >= st.x0 && p.x <= st.x1 && st.blocked(p.x, p.y)) out.push([col, row]);
    }
  }
  return out;
}

type BaseIn = { id: number; playerId: number; name: string; col: number; row: number; state: BaseState };

/**
 * Häfen der Partei mit Satelliten, frisch je Abruf (nur der Teil state.satellites; klein). So stimmen Start, Überflug
 * und Zähler sofort, auch wenn die Hafensensoren noch zwischengespeichert sind.
 */
export async function partySatBases(db: DbOrTx, members: number[]): Promise<BaseIn[]> {
  if (members.length === 0 || !satRules()) return [];
  const rows = await db
    .select({ id: tables.base.id, playerId: tables.base.playerId, name: tables.base.name, col: tables.base.col, row: tables.base.row, sats: sql<SatelliteState[] | null>`${tables.base.state}->'satellites'` })
    .from(tables.base)
    .where(and(inArray(tables.base.playerId, members), sql`${tables.base.state}->'satellites' is not null`));
  return rows.map((r) => ({ id: r.id, playerId: r.playerId, name: r.name, col: r.col, row: r.row, state: { satellites: r.sats ?? [] } as unknown as BaseState }));
}

/** Live-Streifen der Satelliten der Partei (für sightOf). */
export function satelliteSensors(bases: BaseIn[], nowMs: number, ib: IntelBalance) {
  if (!ib.satellite) return [];
  const out = [];
  for (const b of bases) {
    for (const s of activeSatellites(b.state, nowMs)) {
      const p = currentPass(s, nowMs, MAP_WIDTH_KM);
      if (!p) continue;
      out.push({ ...passSensor(s, p), col: b.col, row: b.row, baseId: b.id, playerId: b.playerId, label: `${SAT_NAME[s.type]} (${b.name})` });
    }
  }
  return out;
}

/** Satelliten der Partei für Karte und Lagebild: live, nächster Überflug („über …“), Lebensdauer, letzter Überflug. */
export function satelliteView(bases: BaseIn[], playerId: number, nowMs: number) {
  const out = [];
  for (const b of bases) {
    for (const s of activeSatellites(b.state, nowMs)) {
      const cur = currentPass(s, nowMs, MAP_WIDTH_KM);
      const next = nextPass(s, nowMs, MAP_WIDTH_KM);
      out.push({
        id: s.id, type: s.type, name: SAT_NAME[s.type], own: b.playerId === playerId, baseName: b.name,
        launchedAtMs: s.launchedAtMs, expiresAtMs: s.expiresAtMs, passes: satPassCount(s), passesDone: s.passes ?? 0,
        live: cur ? { k: cur.k, x0: cur.x0, x1: cur.x1, untilMs: cur.endMs, where: stripPlace(cur.x0, cur.x1) } : null,
        next: next ? { k: next.k, x0: next.x0, x1: next.x1, atMs: next.startMs, where: stripPlace(next.x0, next.x1) } : null,
        last: s.last ?? null,
      });
    }
  }
  return out.sort((a, b) => (a.next?.atMs ?? Infinity) - (b.next?.atMs ?? Infinity));
}

/** Forschungsstand eines Spielers (Heimathafen) als Stufen je Technik. */
async function techsOf(tx: DbOrTx, playerId: number): Promise<Record<string, number>> {
  const home = await homeBaseOf(tx, playerId);
  return home ? { ...(home.state.research?.levels ?? {}) } : {};
}

/** Eindeutige Satelliten-ID je Spieler: Startzeit, bei Gleichstand eins über der höchsten vergebenen (unter Spielersperre). */
async function freeSatelliteId(tx: DbOrTx, playerId: number, nowMs: number): Promise<number> {
  const ids = (await basesOfPlayer(tx, playerId)).flatMap((b) => (b.state.satellites ?? []).map((s) => s.id));
  return Math.max(nowMs, ...ids.map((id) => id + 1));
}

/** Satelliten aller Häfen des Spielers, die noch fliegen. */
async function activeCount(tx: DbOrTx, playerId: number, nowMs: number): Promise<number> {
  return (await basesOfPlayer(tx, playerId)).reduce((n, b) => n + activeSatellites(b.state, nowMs).length, 0);
}

/**
 * Startmöglichkeiten für die Oberfläche (Lagebild): je Hafen mit Startrampe und Art Kosten und Sperrgrund, dazu
 * Höchstzahl und laufende Satelliten (ohne Änderung). Ohne Startrampe: leere Liste mit den Regeln.
 */
export async function satelliteOptions(db: DbOrTx, playerId: number, nowMs: number) {
  const sb = satRules();
  if (!sb) return null;
  const techs = await techsOf(db, playerId);
  const bases = await basesOfPlayer(db, playerId);
  const active = bases.reduce((n, b) => n + activeSatellites(b.state, nowMs).length, 0);
  const pads = bases.filter((b) => (b.state.buildings[sb.launchpad] ?? 0) >= 1).map((b) => {
    const state = settle(b.state, nowMs, balance);
    return {
      baseId: b.id, baseName: b.name, padLevel: b.state.buildings[sb.launchpad] ?? 0,
      types: (Object.keys(sb.types) as SatelliteType[]).map((type) => {
        const c = satelliteLaunchCheck(state, type, techs, active, balance);
        return { type, name: SAT_NAME[type], cost: c.ok ? c.cost : satelliteCost(sb.types[type], b.state.buildings[sb.launchpad] ?? 0, sb), code: c.ok ? null : c.code };
      }),
    };
  });
  return {
    pads, active, limit: satelliteLimit(techs, sb),
    techs: { optisch: techs[sb.types.optisch.tech] ?? 0, radar: techs[sb.types.radar.tech] ?? 0 },
    rules: { lifetimeHours: sb.lifetimeHours, periodHours: sb.periodHours, stripKm: sb.stripKm, shiftKm: sb.shiftKm, liveMinutes: sb.liveMinutes, max: sb.max, maxMore: sb.maxMore, cloudMax: sb.types.optisch.cloudMax ?? null },
  };
}

/**
 * Start eines Satelliten von der Startrampe des Hafens. Kosten sofort; erster Überflug nach periodHours über dem
 * Starthafen. Codes: sat_off, sat_type, sat_pad, sat_tech, sat_limit, insufficient_resources.
 */
export async function launchSatellite(engine: Engine, playerId: number, key: string, input: { type: string; baseId?: number }) {
  const jobs: NoticeJob[] = [];
  const r = await runCommand<{ ok: true; satelliteId: number; firstPassAtMs: number; expiresAtMs: number; reportId: number }>(engine, playerId, key, "satellite", async (ctx) => {
    // Höchstzahl gilt spielerweit über alle Häfen: Starts desselben Spielers nacheinander (world-lock.ts).
    await lockPlayerWide(ctx.tx, playerId);
    const own = await lockOwnBase(ctx.tx, playerId, input.baseId);
    const state = settle(own.state, ctx.nowMs, balance, await modsOf(ctx.tx, own, ctx.nowMs));
    const c = satelliteLaunchCheck(state, input.type, await techsOf(ctx.tx, playerId), await activeCount(ctx.tx, playerId, ctx.nowMs), balance);
    if (!c.ok) throw new GameError(c.code);
    if (!hasResources(state.resources, c.cost)) throw new GameError("insufficient_resources");
    const type = input.type as SatelliteType;
    const sat = newSatellite(await freeSatelliteId(ctx.tx, playerId, ctx.nowMs), type, hexCenterXY(own.col, own.row).x, ctx.nowMs, c.sb);
    state.resources = subtractResources(state.resources, c.cost);
    state.satellites = [...activeSatellites(state, ctx.nowMs), sat];
    await saveBase(ctx.tx, own.id, state);
    const first = nextPass(sat, ctx.nowMs, MAP_WIDTH_KM);
    if (first) await scheduleEvent(ctx.tx, "satellite_pass", first.startMs, { baseId: own.id, satId: sat.id, k: first.k }, own.id);
    await scheduleEvent(ctx.tx, "satellite_end", sat.expiresAtMs, { baseId: own.id, satId: sat.id }, own.id);
    const reportId = await storeNavalReport(ctx.tx, {
      kind: "satellit", title: `${SAT_NAME[type]} gestartet`, attackerPlayerId: playerId, defenderPlayerId: null, attackerBaseId: own.id, atMs: ctx.nowMs,
      report: { satellite: {
        event: "start", type, name: SAT_NAME[type], baseName: own.name, cost: c.cost, launchedAtMs: sat.launchedAtMs, expiresAtMs: sat.expiresAtMs,
        passes: satPassCount(sat), periodHours: c.sb.periodHours, stripKm: c.sb.stripKm, liveMinutes: c.sb.liveMinutes, level: c.def.level, cloudMax: c.def.cloudMax ?? null,
        firstPass: first ? { atMs: first.startMs, where: stripPlace(first.x0, first.x1) } : null,
      } },
    });
    ctx.notify.push([[playerId], "base"], [[playerId], "reports"], [null, "map"]);
    jobs.push(pushNotice(playerId, "report", `${SAT_NAME[type]} gestartet`, first ? `Erster Überflug ${stripPlace(first.x0, first.x1)}.` : "Er ist in der Umlaufbahn.", "meldungen", reportId));
    return { ok: true as const, satelliteId: sat.id, firstPassAtMs: first?.startMs ?? sat.expiresAtMs, expiresAtMs: sat.expiresAtMs, reportId };
  });
  if (jobs.length) engine.push?.(jobs);
  return r;
}

/** Tech-Stand für Bots und Tests (Raumfahrt). */
export function spaceTech(state: BaseState): { optisch: number; radar: number } {
  const sb = satRules();
  return { optisch: sb ? techLevel(state, sb.types.optisch.tech) : 0, radar: sb ? techLevel(state, sb.types.radar.tech) : 0 };
}
