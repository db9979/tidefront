// Lagebild Stufe 3 (5.6): Überflug und Ende eines Satelliten (Ereignisse satellite_pass, satellite_end).
// Der Überflug schreibt das Wissen der Partei des Besitzers für alles im Streifen zum Zeitpunkt des Überflugs
// (Häfen, Nester, Felder, Wracks, Posten, Verbände; optisch nicht unter Wolken, Radar nur Sichtung), unabhängig davon,
// ob jemand die Karte öffnet. Danach gilt der Streifen liveMinutes als live (Sicht beim Abruf), später als „bekannt“.
import { atLeast, liveLevelAt, satPass, satPassCount, type IntelLevel, type SatelliteState } from "@tidefront/game-core";
import { hexCenterXY } from "@tidefront/world";
import { tables, type Tx } from "@tidefront/db";
import type { HandlerResult } from "./events.ts";
import { lockBase, saveBase, scheduleEvent } from "./store.ts";
import { partyOf, type Sight } from "./intel-sight.ts";
import { recordSightings, type SightingInput } from "./intel-store.ts";
import { counterWorld, objectMods } from "./intel-counter.ts";
import { sightingsIn } from "./intel-map.ts";
import { MAP_WIDTH_KM, SAT_NAME, passSensor, satRules, stripPlace } from "./intel-sat.ts";
import { pushNotice, storeNavalReport } from "./naval-common.ts";

/** Felder im Streifen (Erkennung; Tarnnetz Stufe 2 des Besitzers: nur Sichtung, zählt nicht). */
async function fieldRows(tx: Tx, sight: Sight, source: string): Promise<SightingInput[]> {
  const rows: SightingInput[] = [];
  const party = new Set(sight.members);
  for (const f of await tx.select().from(tables.resourceField)) {
    if (f.ownerId !== null && party.has(f.ownerId)) continue;
    const { x, y } = hexCenterXY(f.col, f.row);
    const lvl = liveLevelAt(sight.sensors, x, y, "object", objectMods(sight.counter, party, x, y, f.ownerId, "field"));
    if (!lvl || !atLeast(lvl, "erkennung")) continue;
    rows.push({ kind: "field", objectId: f.id, level: lvl, source, data: { ownerId: f.ownerId, guarded: Object.values((f.guard ?? {}) as Record<string, number>).some((n) => n > 0), guardAtMs: f.guardAt?.getTime() ?? null } });
  }
  return rows;
}

/** Überflug k: Wissen schreiben, Zähler fortschreiben, nächsten Überflug planen. */
export async function satellitePass(tx: Tx, payload: Record<string, unknown>, due: number): Promise<HandlerResult> {
  const b = await lockBase(tx, Number(payload.baseId));
  const sats = b?.state.satellites ?? [];
  const sat = sats.find((s) => s.id === Number(payload.satId));
  if (!b || !sat || sat.expiresAtMs <= due) return { notify: [] };
  const p = satPass(sat, Number(payload.k), MAP_WIDTH_KM);
  if (!p) return { notify: [] };
  const { party, members } = await partyOf(tx, b.playerId);
  const sight: Sight = {
    party, members, keys: [party], atMs: p.startMs, counter: await counterWorld(tx, p.startMs),
    sensors: [{ ...passSensor(sat, p), col: b.col, row: b.row, baseId: b.id, playerId: b.playerId, label: `${SAT_NAME[sat.type]} (${b.name})` }],
  };
  const source = `${SAT_NAME[sat.type]} (Überflug ${p.k})`;
  const rows = [...(await sightingsIn(tx, b.playerId, sight, p.startMs)), ...(await fieldRows(tx, sight, source))]
    // Radarsatellit (Sichtung): Häfen, Nester und Felder sind ohnehin bekannt – nichts überschreiben, nur Verbände, Wracks, Posten.
    .filter((r) => atLeast(r.level as IntelLevel, "erkennung") || r.kind === "fleet" || r.kind === "wreck" || r.kind === "post")
    .map((r) => ({ ...r, source }));
  await recordSightings(tx, party, rows, p.startMs);
  // Verdeckt: Objekte im Streifen unter Wolken (nur optisch), für Lagebild und Abschlussbericht.
  const blocked = sight.sensors[0].strip?.blocked;
  let clouded = 0;
  if (blocked) {
    const objs = [
      ...(await tx.select({ col: tables.nest.col, row: tables.nest.row }).from(tables.nest)),
      ...(await tx.select({ col: tables.base.col, row: tables.base.row }).from(tables.base)),
    ];
    for (const o of objs) {
      const { x, y } = hexCenterXY(o.col, o.row);
      if (x >= p.x0 && x <= p.x1 && blocked(x, y)) clouded++;
    }
  }
  const count = (k: string) => rows.filter((r) => r.kind === k).length;
  const next: SatelliteState = {
    ...sat, passes: (sat.passes ?? 0) + 1, seen: (sat.seen ?? 0) + rows.length, clouded: (sat.clouded ?? 0) + clouded,
    last: { k: p.k, atMs: p.startMs, seen: rows.length, clouded, nests: count("nest"), bases: count("base"), fleets: count("fleet") },
  };
  await saveBase(tx, b.id, { ...b.state, satellites: sats.map((s) => (s.id === sat.id ? next : s)) });
  const after = satPass(sat, p.k + 1, MAP_WIDTH_KM);
  if (after) await scheduleEvent(tx, "satellite_pass", after.startMs, { baseId: b.id, satId: sat.id, k: after.k }, b.id);
  return { notify: [[members, "map"]] };
}

/** Ende der Lebensdauer: Satellit verglüht, Abschlussbericht mit den Zahlen der Woche. */
export async function satelliteEnd(tx: Tx, payload: Record<string, unknown>, due: number): Promise<HandlerResult> {
  const b = await lockBase(tx, Number(payload.baseId));
  const sats = b?.state.satellites ?? [];
  const sat = sats.find((s) => s.id === Number(payload.satId));
  if (!b || !sat) return { notify: [] };
  await saveBase(tx, b.id, { ...b.state, satellites: sats.filter((s) => s.id !== sat.id && s.expiresAtMs > due) });
  const name = SAT_NAME[sat.type];
  const reportId = await storeNavalReport(tx, {
    kind: "satellit", title: `${name} verglüht`, attackerPlayerId: b.playerId, defenderPlayerId: null, attackerBaseId: b.id, atMs: due,
    report: { satellite: {
      event: "end", type: sat.type, name, baseName: b.name, launchedAtMs: sat.launchedAtMs, expiresAtMs: sat.expiresAtMs,
      passes: sat.passes ?? 0, plannedPasses: satPassCount(sat), seen: sat.seen ?? 0, clouded: sat.clouded ?? 0,
      last: sat.last ? { ...sat.last, where: stripPlace(...stripOf(sat, sat.last.k)) } : null,
    } },
  });
  const sb = satRules();
  return {
    notify: [[[b.playerId], "base"], [[b.playerId], "reports"], [null, "map"]],
    push: [pushNotice(b.playerId, "report", `${name} verglüht`, `${sat.passes ?? 0} Überflüge, ${sat.seen ?? 0} Sichtungen.${sb ? " Ein neuer Start ist an der Startrampe möglich." : ""}`, "meldungen", reportId)],
  };
}

function stripOf(s: SatelliteState, k: number): [number, number] {
  const p = satPass(s, k, MAP_WIDTH_KM);
  return p ? [p.x0, p.x1] : [0, 0];
}
