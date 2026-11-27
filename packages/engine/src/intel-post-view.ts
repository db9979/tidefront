// Lagebild Stufe 2: Radarposten auf der Karte. Eigene und verbündete immer (mit Reichweite und Betrieb), fremde nur
// live in Sicht oder aus gespeichertem Wissen (kind "post"); mit Kartennebel aus alle.
import { tables, type DbOrTx } from "@tidefront/db";
import { hexCenterXY } from "@tidefront/world";
import { liveAt, sourceAt, type Sight } from "./intel-sight.ts";
import { knownFor, type IntelTag, type SightingInput } from "./intel-store.ts";
import { postRules } from "./intel-post.ts";

export interface MapPost {
  id: number;
  col: number;
  row: number;
  owner: string;
  own: boolean;
  /** Eigene und verbündete: Reichweite und Betrieb; fremde: null. */
  rangeKm: number | null;
  offline: boolean | null;
  intel: IntelTag | null;
}

export async function postsInSight(db: DbOrTx, playerId: number, sight: Sight | null, nowMs: number, rows: SightingInput[], skipKnown = false): Promise<MapPost[]> {
  const pb = postRules();
  if (!pb) return [];
  const posts = await db.select().from(tables.radarPost);
  if (posts.length === 0 && !sight) return [];
  const names = new Map((await db.select({ id: tables.player.id, name: tables.player.name }).from(tables.player)).map((p) => [p.id, p.name]));
  const mates = new Set(sight?.members ?? [playerId]);
  const known = sight && !skipKnown ? await knownFor(db, sight, nowMs, ["post"]) : new Map();
  const out: MapPost[] = [];
  const seen = new Set<number>();
  for (const p of posts) {
    const base = { id: p.id, col: p.col, row: p.row, owner: names.get(p.playerId) ?? "?", own: p.playerId === playerId };
    if (!sight || mates.has(p.playerId)) {
      out.push({ ...base, rangeKm: mates.has(p.playerId) ? pb.rangeKm : null, offline: mates.has(p.playerId) ? p.offline : null, intel: null });
      seen.add(p.id);
      continue;
    }
    const lvl = liveAt(sight, p.col, p.row, "object", { ownerId: p.playerId, kind: "post" }); // Stufe 3: Tarnnetz 2
    if (!lvl) continue;
    const xy = hexCenterXY(p.col, p.row);
    const source = sourceAt(sight, xy.x, xy.y);
    rows.push({ kind: "post", objectId: p.id, level: lvl, source, data: { col: p.col, row: p.row, owner: base.owner } });
    out.push({ ...base, rangeKm: null, offline: null, intel: { age: "live", atMs: nowMs, source, level: lvl } });
    seen.add(p.id);
  }
  if (sight) {
    for (const k of known.values()) {
      if (k.kind !== "post" || seen.has(k.objectId)) continue;
      const d = k.data as { col: number; row: number; owner: string };
      // Im Sensorbereich und nicht mehr da: abgebaut oder zerstört – das sieht man.
      if (liveAt(sight, d.col, d.row)) continue;
      out.push({ id: k.objectId, col: d.col, row: d.row, owner: d.owner, own: false, rangeKm: null, offline: null, intel: { age: k.age, atMs: k.seenAtMs, source: k.source, level: k.level } });
    }
  }
  return out;
}
