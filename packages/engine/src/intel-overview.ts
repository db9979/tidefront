// Lagebild Stufe 2 (8): Reiter „Lagebild“ unter Meldungen – letzte Sichtungen, fremde Patrouillen (gesichtet und
// gemeldet), eigene Sensoren (Häfen, Radarposten, Patrouillen, Aufklärer) mit Reichweite. Dieselbe Sicht wie die Karte.
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { tables } from "@tidefront/db";
import type { Engine } from "./context.ts";
import { intelFogOn, intelRules, sightOf } from "./intel-sight.ts";
import { knownFor } from "./intel-store.ts";
import { postRules } from "./intel-post.ts";
import { mapViewFor } from "./intel-map.ts";
import { satelliteOptions } from "./intel-sat.ts"; // Stufe 3
import { FIELD_KIND_TEXT } from "./fields-core.ts";

const HOUR_MS = 3600000;

export async function intelOverview(engine: Engine, playerId: number) {
  const db = engine.db;
  const nowMs = Date.now();
  const ib = intelRules();
  if (!ib) return { enabled: false as const };
  const fog = await intelFogOn(db, nowMs);
  const sight = await sightOf(db, playerId, nowMs);
  const known = await knownFor(db, sight, nowMs, ["base", "nest", "field", "wreck", "fleet", "post"]);
  const bases = await db.select({ id: tables.base.id, name: tables.base.name, col: tables.base.col, row: tables.base.row, playerId: tables.base.playerId }).from(tables.base);
  const baseById = new Map(bases.map((b) => [b.id, b]));
  const nests = new Map((await db.select({ id: tables.nest.id, col: tables.nest.col, row: tables.nest.row }).from(tables.nest)).map((n) => [n.id, n]));
  const fields = new Map((await db.select({ id: tables.resourceField.id, col: tables.resourceField.col, row: tables.resourceField.row, kind: tables.resourceField.kind }).from(tables.resourceField)).map((f) => [f.id, f]));
  const mates = new Set(sight.members);
  // Live in Sicht (dieselbe Kartenansicht; speichert die Sichtungen wie beim Kartenabruf) vor dem gespeicherten Wissen.
  const view = await mapViewFor(db, playerId, nowMs);
  const live = [
    ...view.nests.filter((n) => n.intel?.age === "live").map((n) => ({ kind: "nest" as const, id: n.id, name: n.level === null ? "Piratennest" : `Piratennest Stufe ${n.level}${n.empty ? " (verlassen)" : ""}`, col: n.col, row: n.row, intel: n.intel!, patrol: false })),
    ...view.bases.filter((b) => !b.own && b.intel?.age === "live").map((b) => ({ kind: "base" as const, id: b.id, name: `Hafen ${b.name}`, col: b.col, row: b.row, intel: b.intel!, patrol: false })),
    ...view.fleets.filter((f) => f.intel.age === "live").map((f) => ({ kind: "fleet" as const, id: f.id, name: `${f.patrol ? "Patrouille" : "Verband"} ${f.owner ? `von ${f.owner}` : "(unbekannt)"} · ${f.size}`, col: f.col, row: f.row, intel: f.intel, patrol: !!f.patrol })),
    ...view.wrecks.filter((w) => w.intel?.age === "live").map((w) => ({ kind: "wreck" as const, id: w.id, name: "Wrackfeld", col: w.col, row: w.row, intel: w.intel!, patrol: false })),
  ].map((x) => ({ kind: x.kind, id: x.id, name: x.name, col: x.col, row: x.row, level: x.intel.level, source: x.intel.source, atMs: x.intel.atMs, age: "live" as const, patrol: x.patrol }));
  const liveKeys = new Set(live.map((x) => `${x.kind}:${x.id}`));
  const stored = [...known.values()]
    .filter((k) => !liveKeys.has(`${k.kind}:${k.objectId}`))
    .filter((k) => !(k.kind === "base" && mates.has(baseById.get(k.objectId)?.playerId ?? -1)))
    .sort((a, b) => b.seenAtMs - a.seenAtMs)
    .slice(0, 40)
    .map((k) => {
      const d = k.data as Record<string, unknown>;
      const pos = k.kind === "base" ? baseById.get(k.objectId) : k.kind === "nest" ? nests.get(k.objectId) : k.kind === "field" ? fields.get(k.objectId) : { col: Number(d.col), row: Number(d.row) };
      const name = k.kind === "base" ? `Hafen ${baseById.get(k.objectId)?.name ?? "?"}`
        : k.kind === "nest" ? (typeof d.level === "number" ? `Piratennest Stufe ${d.level}${d.empty ? " (verlassen)" : ""}` : "Piratennest")
        : k.kind === "field" ? (FIELD_KIND_TEXT[fields.get(k.objectId)?.kind ?? ""] ?? "Rohstofffeld")
        : k.kind === "wreck" ? "Wrackfeld"
        : k.kind === "post" ? `Radarposten (${String(d.owner ?? "?")})`
        : `${d.patrol ? "Patrouille" : "Verband"} ${d.owner ? `von ${String(d.owner)}` : "(unbekannt)"} · ${String(d.size ?? "")}`;
      return { kind: k.kind, id: k.objectId, name, col: pos?.col ?? 0, row: pos?.row ?? 0, level: k.level, source: k.source, atMs: k.seenAtMs, age: k.age as string, patrol: k.kind === "fleet" && !!d.patrol };
    });
  const sightings = [...live, ...stored].slice(0, 40);
  // Gemeldete fremde Patrouillen und Aufklärer (Berichte „sichtung“ der letzten 24 h an die Partei).
  const reports = await db.select().from(tables.battleReport).where(and(
    eq(tables.battleReport.kind, "sichtung"), inArray(tables.battleReport.defenderPlayerId, sight.members), gt(tables.battleReport.createdAt, new Date(nowMs - 24 * HOUR_MS)),
  )).orderBy(desc(tables.battleReport.id)).limit(20);
  const reported = reports.map((r) => {
    const s = (r.report as { sighting?: { owner?: string; scout?: boolean; baseName?: string; col?: number; row?: number } }).sighting ?? {};
    return { id: r.id, title: r.title, owner: s.owner ?? "?", scout: !!s.scout, baseName: s.baseName ?? "", col: s.col ?? null, row: s.row ?? null, atMs: r.createdAt.getTime() };
  });
  const ownPosts = await db.select().from(tables.radarPost).where(eq(tables.radarPost.playerId, playerId));
  const pb = postRules();
  return {
    enabled: true as const,
    fog,
    serverNow: nowMs,
    sightings,
    patrols: sightings.filter((s) => s.patrol),
    reported,
    sensors: sight.sensors.map((s) => ({ kind: s.kind, label: s.label, km: s.km, col: s.col, row: s.row, own: s.playerId === playerId })),
    posts: ownPosts.map((p) => ({ id: p.id, col: p.col, row: p.row, crew: p.crew as Record<string, number>, offline: p.offline, baseName: baseById.get(p.baseId)?.name ?? "?", rangeKm: pb?.rangeKm ?? 0 })),
    rules: { patrol: ib.patrol ?? null, campaign: ib.campaign ?? null, post: ib.post ?? null, sonar: ib.sonar ?? null },
    /** Stufe 3: Satelliten der Partei (nächster Überflug „über …“) und Startmöglichkeiten an eigenen Startrampen. */
    satellites: view.intel.satellites,
    launch: await satelliteOptions(db, playerId, nowMs),
  };
}
