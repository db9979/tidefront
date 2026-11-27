// See: Konvois für Karte, Börse und Lagebild (docs/REGELN-SEE.md, Abschnitt Konvois; docs/REGELN-LAGEBILD.md).
// Eigene Konvois (Empfänger oder Absender) und die von Kriegsgegnern mit Route und Zeiten; fremde Konvois erscheinen
// mit Kartennebel nur in Sensorreichweite der Partei (Allianz teilt Sicht): Sichtung zeigt Größe und Kurs, Erkennung
// dazu Art, Absender, Empfänger und Geleit. Die Ladung fremder Konvois steht nur mit Lagebild (Spionage im Zielhafen)
// genau da, sonst als Größenklasse. Ohne Kartennebel wie bis 0.17: nur eigene und feindliche (mit Ladung).
import { and, eq, gt, inArray } from "drizzle-orm";
import { atLeast, cargoSizeClass, convoyPosition, headingDeg, type Counts, type IntelLevel, type ResourceMap } from "@tidefront/game-core";
import { hexAtXY, seaRoute, tradePortNameAt } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { atWar, relationsOf, type Relation } from "./alliance-core.ts";
import { intelFogOn, intelRules, liveAt, sightOf, sourceAt, type Sight } from "./intel-sight.ts";
import { knownFor, knownGet, type IntelTag, type Known } from "./intel-store.ts";
import { activeCounts, hasShips } from "./naval-common.ts";
import type { ConvoyEvent, ConvoyRow } from "./naval-convoy.ts";

/** Konvoi, wie Karte und Börse ihn zeigen. Felder, die der Betrachter nicht kennt, sind null. */
export interface ConvoyView {
  id: number;
  /** handel | boerse | vertrag | transport | feld; null = nur gesichtet (Art unbekannt). */
  kind: string | null;
  own: boolean;
  /** Kriegsgegner (Empfänger oder Absender): abfangbar. */
  enemy: boolean;
  /** Verhältnis zum Betrachter (Erkennung), null bei bloßer Sichtung. */
  relation: Relation | "own" | null;
  deliveryId: string | null;
  missionId: number | null;
  /** Route und Zeiten: nur eigene und feindliche Konvois (die Karte bewegt sie mit convoyPosition). */
  from: { col: number; row: number } | null;
  to: { col: number; row: number } | null;
  route: [number, number][] | null;
  departAtMs: number | null;
  arriveAtMs: number | null;
  /** Position jetzt (Feld und Projektions-km) und Kurs in Grad. */
  at: { col: number; row: number };
  x: number;
  y: number;
  heading: number;
  /** Ladung genau (eigene, Lagebild) oder null; Größenklasse immer. */
  cargo: ResourceMap | null;
  size: "klein" | "mittel" | "gross";
  escort: Counts | null;
  escorted: boolean | null;
  events: ConvoyEvent[];
  sender: string | null;
  recipient: string | null;
  recipientBase: string | null;
  /** Fremde Konvois: Herkunft der Angabe (live, Quelle, Stufe). */
  intel: IntelTag | null;
}

const toRoute = (hexes: readonly (readonly [number, number])[]) => hexes.map(([c, r]) => [c, r] as [number, number]);

/** Konvois für Karte und Börse (naval.view). */
export async function convoysView(db: DbOrTx, playerId: number, nowMs: number): Promise<ConvoyView[]> {
  const rows = (await db.select().from(tables.convoy).where(and(eq(tables.convoy.status, "underway"), gt(tables.convoy.arriveAt, new Date(nowMs))))) as ConvoyRow[];
  if (rows.length === 0) return [];
  const war = new Map<number, boolean>();
  const enemy = async (id: number | null) => {
    if (id === null || id === playerId) return false;
    if (!war.has(id)) war.set(id, await atWar(db, playerId, id, nowMs));
    return war.get(id)!;
  };
  const fog = !!intelRules() && (await intelFogOn(db, nowMs));
  let sight: Sight | null = null;
  let known: Map<string, Known> | null = null;
  let relations: Map<number, Relation> | null = null;
  const names = new Map<number, string>();
  const nameOf = async (id: number) => {
    if (!names.has(id)) {
      const [p] = await db.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, id));
      names.set(id, p?.name ?? "?");
    }
    return names.get(id)!;
  };
  const baseIds = [...new Set(rows.map((r) => r.recipientBaseId))];
  const baseNames = new Map((await db.select({ id: tables.base.id, name: tables.base.name }).from(tables.base).where(inArray(tables.base.id, baseIds))).map((b) => [b.id, b.name]));

  const out: ConvoyView[] = [];
  for (const c of rows) {
    const own = c.recipientId === playerId || c.senderId === playerId;
    const hostile = !own && ((await enemy(c.recipientId)) || (await enemy(c.senderId)));
    const from = { col: c.fromCol, row: c.fromRow };
    const to = { col: c.toCol, row: c.toRow };
    const route = seaRoute(from, to);
    const pos = convoyPosition({ route, from, to, departAtMs: c.departAt.getTime(), arriveAtMs: c.arriveAt.getTime() }, nowMs);
    const here = hexAtXY(pos.at.x, pos.at.y);
    // Fremd: nur mit Kartennebel und in Sensorreichweite der Partei (Kriegsgegner wie bisher immer).
    let level: IntelLevel | null = own ? "lagebild" : null;
    if (!own && fog) {
      sight ??= await sightOf(db, playerId, nowMs);
      level = liveAt(sight, here.col, here.row, "fleet");
    }
    if (!own && !hostile && !level) continue;
    const recognized = own || hostile || atLeast(level, "erkennung");
    // Lagebild (Spionage im Zielhafen): Ladung und Geleit genau. Ohne Kartennebel sehen Kriegsgegner beides wie bisher.
    let exact = own || (!fog && hostile);
    if (!exact && fog && sight) {
      known ??= await knownFor(db, sight, nowMs, ["base"]);
      const k = knownGet(known, "base", c.recipientBaseId);
      exact = !!k && k.level === "lagebild" && k.age !== "veraltet";
    }
    const cargo = c.cargo as ResourceMap;
    const escort = activeCounts(c.escort as Counts);
    let relation: ConvoyView["relation"] = null;
    if (own) relation = "own";
    else if (hostile) relation = "krieg";
    else if (recognized) {
      relations ??= await relationsOf(db, playerId, nowMs);
      relation = relations.get(c.recipientId) ?? "neutral";
    }
    const routed = own || hostile;
    const port = c.senderId === null ? tradePortNameAt(c.fromCol, c.fromRow) : null;
    out.push({
      id: c.id, kind: recognized ? c.kind : null, own, enemy: hostile, relation,
      deliveryId: own ? c.deliveryId : null, missionId: own ? c.missionId : null,
      from: routed ? from : null, to: routed ? to : null, route: routed ? toRoute(route.hexes) : null,
      departAtMs: routed ? c.departAt.getTime() : null, arriveAtMs: routed ? c.arriveAt.getTime() : null,
      at: here, x: Math.round(pos.at.x), y: Math.round(pos.at.y), heading: headingDeg(pos.from, pos.to),
      cargo: exact ? cargo : null, size: cargoSizeClass(cargo, balance),
      escort: exact ? escort : null, escorted: recognized ? hasShips(escort) : null,
      events: routed ? ((c.events as ConvoyEvent[]) ?? []) : [],
      sender: !recognized ? null : c.senderId === null ? (port ? `Handelshafen ${port}` : null) : c.senderId === playerId ? "du" : await nameOf(c.senderId),
      recipient: !recognized ? null : c.recipientId === playerId ? "du" : await nameOf(c.recipientId),
      recipientBase: recognized ? baseNames.get(c.recipientBaseId) ?? null : null,
      intel: own || !level || !sight ? null : { age: "live", atMs: nowMs, source: sourceAt(sight, pos.at.x, pos.at.y), level },
    });
  }
  return out;
}
