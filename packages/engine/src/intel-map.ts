// Lagebild: Kartenansicht (world.map) nach Sicht gefiltert. Hafenpositionen, Namen, Besitzer und Nest-Positionen sind
// immer sichtbar; Schutzstatus, Nest-Stufe/-Zustand und Wracks nur live (Sensor) oder aus gespeichertem Wissen;
// fremde Verbände nur live (Radar: Sichtung mit Größenklasse und Kurs, Ausguck: Erkennung mit Besitzer) und ihre letzte
// Sichtung fleetMemoryHours. Mit intel_fog aus sehen alle alles wie bis 0.17 (keine fremden Verbände).
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  atLeast,
  disinfoSize,
  fleetSize,
  headingDeg,
  liveLevelAt,
  visibleUnitCount,
  wreckRemaining,
  type BaseState,
  type Counts,
  type FleetSize,
  type IntelLevel,
  type Mission,
} from "@tidefront/game-core";
import { hexAtXY, hexCenterXY } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { relationsOf, type Relation } from "./alliance-core.ts";
import { intelFogOn, intelRules, liveAt, sightOf, sourceAt, type Sight } from "./intel-sight.ts";
import { knownFor, knownGet, nestData, persistLive, protectionOf, type IntelTag, type SightingInput } from "./intel-store.ts";
import { fleetPosition } from "./intel-route.ts";
import { postsInSight } from "./intel-post-view.ts"; // Lagebild Stufe 2: Radarposten auf der Karte
import { fleetMods, revealedJammers } from "./intel-counter.ts"; // Stufe 3: Gegenmittel
import { satelliteView, stripCells } from "./intel-sat.ts"; // Stufe 3: Satelliten

type XY = { x: number; y: number };
export type FleetRelation = Relation | "kartell";

/** Verband auf See, wie die Karte ihn zeigt. */
export interface MapFleet {
  id: number;
  col: number;
  row: number;
  heading: number;
  size: FleetSize;
  /** Mit Erkennung: Besitzer und Verhältnis, sonst null (nur „da ist etwas“). */
  owner: string | null;
  relation: FleetRelation | null;
  /** Stufe 2: Verband ist eine Patrouille (Lagebild-Reiter „Fremde Patrouillen“). */
  patrol?: boolean;
  intel: IntelTag;
}

const live = (nowMs: number, source: string, level: IntelLevel): IntelTag => ({ age: "live", atMs: nowMs, source, level });

export { fleetPosition } from "./intel-route.ts";

async function allBases(db: DbOrTx) {
  return db
    .select({ id: tables.base.id, name: tables.base.name, col: tables.base.col, row: tables.base.row, playerId: tables.base.playerId, owner: tables.player.name, state: tables.base.state })
    .from(tables.base)
    .innerJoin(tables.player, eq(tables.player.id, tables.base.playerId));
}

/** Kartenansicht für einen Spieler (world.map). */
export async function mapViewFor(db: DbOrTx, playerId: number, nowMs: number) {
  return (await mapViewFrom(db, playerId, nowMs, await allBases(db))).view;
}

/**
 * Stufe 3: Was eine vorgegebene Sicht (z. B. nur der Streifen eines Satelliten zum Überflug) jetzt erfasst – als
 * Sichtungen zum Speichern (Häfen, Nester, Wracks, Posten, Verbände; gleiche Regeln wie die Karte). Speichert nichts.
 */
export async function sightingsIn(db: DbOrTx, playerId: number, sight: Sight, atMs: number): Promise<SightingInput[]> {
  return (await mapViewFrom(db, playerId, atMs, await allBases(db), sight)).rows;
}

type BaseIn = { id: number; name: string; col: number; row: number; playerId: number; owner: string; state: unknown };

async function mapViewFrom(db: DbOrTx, playerId: number, nowMs: number, bases: BaseIn[], only?: Sight) {
  const nests = await db.select().from(tables.nest);
  const wrecks = await db.select().from(tables.wreck);
  // Freund/Feind aus Sicht des Betrachters (nur eigene Allianz, eigene Pakte und Kriege).
  const relations = await relationsOf(db, playerId, nowMs);
  const fog = only ? true : await intelFogOn(db, nowMs);
  const ib = intelRules();
  const sight = only ?? (ib ? await sightOf(db, playerId, nowMs) : null);
  const known = fog && sight && !only ? await knownFor(db, sight, nowMs, ["base", "nest", "wreck", "fleet"]) : new Map();
  const mates = new Set(sight?.members ?? [playerId]);
  const rows: SightingInput[] = [];
  // Häfen und Nester: nur Erkennung zeigt mehr als die Position (Sichtung, z. B. Radarsatellit oder Tarnnetz, nicht).
  const seeObject = (col: number, row: number, ownerId: number | null = null, kind: "base" | "other" = "other") => {
    const lvl = fog && sight ? liveAt(sight, col, row, "object", { ownerId, kind }) : null;
    return lvl && atLeast(lvl, "erkennung") ? lvl : null;
  };
  const seeAny = (col: number, row: number) => (fog && sight ? liveAt(sight, col, row) : null);
  const jammed = fog && sight ? revealedJammers(sight.counter, mates, sight.sensors) : new Set<number>();
  const srcAt = (col: number, row: number) => { const p = hexCenterXY(col, row); return sight ? sourceAt(sight, p.x, p.y) : "Sensor"; };

  const outBases = bases.map((b) => {
    const own = b.playerId === playerId;
    const base = {
      id: b.id, name: b.name, col: b.col, row: b.row, owner: b.owner, own,
      relation: own ? ("own" as const) : relations.get(b.playerId) ?? ("neutral" as const),
    };
    const current = protectionOf(b.state, nowMs);
    if (!fog || mates.has(b.playerId)) return { ...base, protection: current, known: true, intel: null as IntelTag | null, jammer: false };
    const withJammer = { ...base, jammer: jammed.has(b.id) }; // Stufe 3: fremder Störsender, vom eigenen Radar erkannt
    const lvl = seeObject(b.col, b.row, b.playerId, "base");
    if (lvl) {
      const source = srcAt(b.col, b.row);
      rows.push({ kind: "base", objectId: b.id, level: lvl, source, data: { protection: current } });
      return { ...withJammer, protection: current, known: true, intel: live(nowMs, source, lvl) };
    }
    const k = knownGet(known, "base", b.id);
    if (!k) return { ...withJammer, protection: null, known: false, intel: null };
    return { ...withJammer, protection: (k.data.protection as string | null) ?? null, known: true, intel: { age: k.age, atMs: k.seenAtMs, source: k.source, level: k.level } as IntelTag };
  });

  const outNests = nests.map((n) => {
    const data = nestData(n, nowMs);
    const pos = { id: n.id, col: n.col, row: n.row };
    if (!fog) return { ...pos, ...data, known: true, intel: null as IntelTag | null };
    const lvl = seeObject(n.col, n.row);
    if (lvl) {
      const source = srcAt(n.col, n.row);
      rows.push({ kind: "nest", objectId: n.id, level: lvl, source, data });
      return { ...pos, ...data, known: true, intel: live(nowMs, source, lvl) };
    }
    const k = knownGet(known, "nest", n.id);
    if (!k) return { ...pos, level: null, empty: null, respawnAtMs: null, known: false, intel: null };
    const d = k.data as ReturnType<typeof nestData>;
    // Bekannte Wiederkehr: nach Ablauf gilt das Nest als wieder besetzt (das weiß jeder, der die Zeit kennt).
    const empty = d.empty && (d.respawnAtMs === null || d.respawnAtMs > nowMs);
    return { ...pos, level: d.level, empty, respawnAtMs: empty ? d.respawnAtMs : null, known: true, intel: { age: k.age, atMs: k.seenAtMs, source: k.source, level: k.level } as IntelTag };
  });

  const outWrecks: { id: number; col: number; row: number; stahl: number; elektronik: number; intel: IntelTag | null }[] = [];
  const remaining = (w: { stahl: number; elektronik: number; createdAtMs: number }) => wreckRemaining(w, nowMs, balance) as { stahl: number; elektronik: number };
  const seenWrecks = new Set<number>();
  for (const w of wrecks) {
    const raw = { stahl: w.stahl, elektronik: w.elektronik, createdAtMs: w.createdAt.getTime() };
    const r = remaining(raw);
    if (r.stahl + r.elektronik <= 0) continue;
    const lvl = seeAny(w.col, w.row);
    if (fog && !lvl) continue;
    seenWrecks.add(w.id);
    const source = fog ? srcAt(w.col, w.row) : "";
    if (fog) rows.push({ kind: "wreck", objectId: w.id, level: lvl!, source, data: { col: w.col, row: w.row, ...raw } });
    outWrecks.push({ id: w.id, col: w.col, row: w.row, ...r, intel: fog ? live(nowMs, source, lvl!) : null });
  }
  if (fog) {
    for (const k of known.values()) {
      if (k.kind !== "wreck" || seenWrecks.has(k.objectId)) continue;
      const d = k.data as { col: number; row: number; stahl: number; elektronik: number; createdAtMs: number };
      // Im Sensorbereich und nicht mehr da: geborgen oder verfallen – das sieht man.
      if (seeAny(d.col, d.row)) continue;
      const r = remaining(d);
      if (r.stahl + r.elektronik <= 0) continue;
      outWrecks.push({ id: k.objectId, col: d.col, row: d.row, ...r, intel: { age: k.age, atMs: k.seenAtMs, source: k.source, level: k.level } });
    }
  }

  const fleets = fog && sight ? await fleetsInSight(db, sight, nowMs, bases, nests, relations, known, rows) : [];
  const posts = await postsInSight(db, playerId, fog ? sight : null, nowMs, rows, !!only); // Stufe 2: Radarposten
  if (only) return { rows, view: null as never };
  if (fog && sight) await persistLive(db, sight, "map", nowMs, () => rows);
  const view = {
    serverNow: nowMs,
    bases: outBases,
    nests: outNests,
    wrecks: outWrecks,
    fleets,
    posts,
    /** Lagebild: Kartennebel an/aus und die eigenen Sensoren (Allianz eingeschlossen) für Nebel und Sensorgrenzen. */
    intel: {
      fog,
      sensors: (sight?.sensors ?? []).map((s) => ({
        col: s.col, row: s.row, km: s.km, kind: s.kind, label: s.label, own: s.playerId === playerId,
        // Stufe 3: Satellitenstreifen (x0 … x1) und die unter Wolken verdeckten Felder (optisch).
        ...(s.strip ? { strip: { x0: s.strip.x0, x1: s.strip.x1, hidden: stripCells(s) } } : {}),
      })),
      /** Stufe 3: Satelliten der Partei (live, nächster Überflug mit Ort, Lebensdauer). */
      satellites: satelliteView(sight?.satBases ?? [], playerId, nowMs),
      /** Stufe 2: Regeln für Planung und Anzeige (Patrouille, Kampagne, Radarposten). */
      ops: ib ? { patrol: ib.patrol ?? null, campaign: ib.campaign ?? null, post: ib.post ?? null } : null,
      staleHours: ib?.staleHours ?? 24,
    },
  };
  return { rows, view };
}

/** Fremde Verbände auf See in Sicht der Partei (live) und ihre letzten Sichtungen. */
async function fleetsInSight(
  db: DbOrTx, sight: Sight, nowMs: number, bases: BaseIn[], nests: { col: number; row: number }[],
  relations: Map<number, Relation>, known: Map<string, import("./intel-store.ts").Known>, rows: SightingInput[],
): Promise<MapFleet[]> {
  const ib = intelRules()!;
  // Stufe 2: Patrouillen auf Station (holding) fahren ihre Runde und sind ebenfalls auf See.
  const missions = (await db.select().from(tables.mission).where(and(inArray(tables.mission.status, ["outbound", "returning", "holding"]), ne(tables.mission.type, "spionage"))))
    .filter((m) => m.status !== "holding" || m.type === "patrouille");
  const baseXY = new Map(bases.map((b) => [b.id, hexCenterXY(b.col, b.row)]));
  const names = new Map(bases.map((b) => [b.playerId, b.owner]));
  const mates = new Set(sight.members);
  const memberBases = new Set(bases.filter((b) => mates.has(b.playerId)).map((b) => b.id));
  const nestXY = nests.map((n) => hexCenterXY(n.col, n.row));
  const baseState = new Map(bases.map((b) => [b.id, b.state as BaseState]));
  const defs = { ...balance.npcUnits, ...balance.units };
  const out: MapFleet[] = [];
  const shown = new Set<number>();
  for (const m of missions) {
    if (m.playerId !== null && mates.has(m.playerId)) continue; // eigene und verbündete Verbände zeigt die Karte schon
    const target = hexCenterXY(m.targetCol, m.targetRow);
    // Kartell: läuft vom nächsten Nest aus.
    const origin = m.baseId !== null ? baseXY.get(m.baseId) : nestXY.reduce<XY | undefined>((best, p) => (!best || (p.x - target.x) ** 2 + (p.y - target.y) ** 2 < (best.x - target.x) ** 2 + (best.y - target.y) ** 2 ? p : best), undefined);
    if (!origin) continue;
    const pos = fleetPosition(m, origin, target, nowMs);
    if (!pos) continue;
    const units = (m.status === "returning" || m.status === "holding" ? (m.returning as Counts | null) : null) ?? ((m.plan as { units?: Counts }).units ?? {});
    // U-Boote sieht nur das Sonar (U-Jagd im Hafen oder auf Patrouille, U-Boote auf Patrouille); 5.7.
    const subs = Object.entries(units).reduce((a, [id, c]) => a + (c > 0 && defs[id]?.submerged ? c : 0), 0);
    const sonar = subs > 0 ? liveLevelAt(sight.sensors, pos.at.x, pos.at.y, "submarine") : null;
    const n = visibleUnitCount(units, defs) + (sonar ? subs : 0);
    if (n <= 0) continue; // nur U-Boote ohne Sonar: für Radar und Ausguck unsichtbar
    const h = hexAtXY(pos.at.x, pos.at.y);
    let level = liveAt(sight, h.col, h.row, "fleet", fleetMods(sight.counter, mates, pos.at.x, pos.at.y, m, units, defs));
    if (sonar && (!level || visibleUnitCount(units, defs) === 0)) level = sonar;
    // Vom Radar des Ziels erkannter Angriff (Vorwarnzeit): erscheint als Verband, auch außerhalb der Reichweite.
    const detected = (m.plan as Partial<Mission>).detectedAtMs;
    if (!level && m.status === "outbound" && m.targetKind === "base" && m.targetId !== null && memberBases.has(m.targetId) && typeof detected === "number" && detected <= nowMs) level = "sichtung";
    if (!level) continue;
    const recognized = atLeast(level, "erkennung");
    // Desinformation (7): hat der Ausgangshafen eine Desinformation gegen die Partei hinterlegt, ist die Größe falsch.
    const disinfo = (m.baseId !== null ? (baseState.get(m.baseId)?.intel?.disinfo ?? {}) : {}) as Record<string, number>;
    const fooled = sight.members.some((p) => (disinfo[String(p)] ?? 0) > nowMs);
    const fleet: MapFleet = {
      id: m.id, col: h.col, row: h.row, heading: headingDeg(pos.from, pos.to), size: fooled ? disinfoSize(fleetSize(n, ib), m.id) : fleetSize(n, ib),
      patrol: m.type === "patrouille",
      owner: recognized ? (m.playerId === null ? "Freibeuter-Kartell" : names.get(m.playerId) ?? "?") : null,
      relation: recognized ? (m.playerId === null ? "kartell" : relations.get(m.playerId) ?? "neutral") : null,
      intel: live(nowMs, sourceAt(sight, pos.at.x, pos.at.y), level),
    };
    out.push(fleet);
    shown.add(m.id);
    rows.push({ kind: "fleet", objectId: m.id, level, source: fleet.intel.source, data: { col: fleet.col, row: fleet.row, heading: fleet.heading, size: fleet.size, owner: fleet.owner, relation: fleet.relation, patrol: fleet.patrol } });
  }
  for (const k of known.values()) {
    if (k.kind !== "fleet" || shown.has(k.objectId)) continue;
    const d = k.data as Omit<MapFleet, "id" | "intel">;
    out.push({ ...d, id: k.objectId, intel: { age: k.age, atMs: k.seenAtMs, source: k.source, level: k.level } });
  }
  return out;
}
