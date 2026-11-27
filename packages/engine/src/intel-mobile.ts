// Lagebild Stufe 2: Sensoren außerhalb der Hafengebäude – Bordsicht jedes eigenen Verbands auf See (beste Einheit:
// Kriegsschiff, Transporter, Drohne Erkennung; Flugzeuge nur Sichtung), Patrouillen (Sicht und Sonar um die Position),
// Aufklärer unterwegs (Erkennung um die Route, auch Kampagnen), Radarposten (wie Radar, ohne Treibstoff aus) und das
// Sonar der U-Jagd-Einheiten im Hafen (5.7). Eingehängt in sightOf (intel-sight.ts); gleiche Kreise wie die Karte.
import { and, inArray } from "drizzle-orm";
import { fleetSightKm, sonarKm, techLevel, type BaseState, type Counts, type IntelBalance } from "@tidefront/game-core";
import { hexAtXY, hexCenterXY } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { fleetPosition, type RoutedPlan } from "./intel-route.ts";
import type { Sensor } from "./intel-sight.ts";

type BaseIn = { id: number; playerId: number; name: string; col: number; row: number; state: BaseState; isHome?: boolean };

const defs = () => ({ ...balance.npcUnits, ...balance.units }) as Record<string, { branch?: string; submerged?: boolean; attack?: { uboot?: number } }>;

/** Sonar-Stufe eines Spielers (Forschung liegt im Heimathafen). */
function sonarLevelOf(bases: BaseIn[], playerId: number): number {
  const home = bases.find((b) => b.playerId === playerId && b.isHome) ?? bases.find((b) => b.playerId === playerId);
  return home ? techLevel(home.state, "sonar") : 0;
}

/** Bewegte und zusätzliche Sensoren der Partei (Mitglieder `members`, ihre Häfen `bases`). */
export async function mobileSensors(db: DbOrTx, members: number[], bases: BaseIn[], nowMs: number, ib: IntelBalance): Promise<Sensor[]> {
  const out: Sensor[] = [];
  const d = defs();
  const byId = new Map(bases.map((b) => [b.id, b]));
  // Sonar im Hafen: U-Jagd-Einheiten daheim.
  if (ib.sonar) {
    for (const b of bases) {
      const km = sonarKm(b.state.units, d, sonarLevelOf(bases, b.playerId), ib.sonar, false);
      if (km > 0) out.push({ kind: "sonar", km, ...hexCenterXY(b.col, b.row), col: b.col, row: b.row, baseId: b.id, playerId: b.playerId, label: `Sonar ${b.name}` });
    }
  }
  if (members.length === 0) return out;
  const missions = await db.select().from(tables.mission).where(and(
    inArray(tables.mission.playerId, members),
    inArray(tables.mission.status, ["outbound", "holding", "returning"]),
  ));
  for (const m of missions) {
    const b = m.baseId !== null ? byId.get(m.baseId) : undefined;
    if (!b || m.playerId === null) continue;
    if (m.type === "spionage") continue; // Spione reisen verdeckt
    const plan = m.plan as RoutedPlan;
    // Blockade (holding) liegt vor dem Ziel; Patrouillen fahren ihre Runde (fleetPosition).
    const pos = m.status === "holding" && m.type !== "patrouille"
      ? { at: hexCenterXY(m.targetCol, m.targetRow) }
      : fleetPosition(m, hexCenterXY(b.col, b.row), hexCenterXY(m.targetCol, m.targetRow), nowMs);
    if (!pos) continue;
    const h = hexAtXY(pos.at.x, pos.at.y);
    const common = { x: pos.at.x, y: pos.at.y, col: h.col, row: h.row, baseId: b.id, playerId: m.playerId, missionId: m.id };
    if (m.type === "aufklaerung" && m.status === "outbound" && ib.campaign) {
      out.push({ ...common, kind: "aufklaerer", km: ib.campaign.revealKm, label: `Aufklärer aus ${b.name}` });
    }
    const p = plan.patrol;
    if (!p) {
      // Bordsicht (Entscheidung 27.11.2026): beste Einheit des Verbands; Sonar wie im Hafen.
      const units = ((m.status === "returning" || m.status === "holding" ? (m.returning as Counts | null) : null) ?? plan.units ?? {}) as Counts;
      const fs = fleetSightKm(units, d, ib.fleetSight);
      if (fs.recognizeKm > 0) out.push({ ...common, kind: "verband", km: fs.recognizeKm, label: `Verband aus ${b.name}` });
      if (fs.sightKm > 0) out.push({ ...common, kind: "flug", km: fs.sightKm, label: `Flugzeuge aus ${b.name}` });
      const sk = sonarKm(units, d, sonarLevelOf(bases, m.playerId), ib.sonar, true);
      if (sk > 0) out.push({ ...common, kind: "sonar", km: sk, label: `Sonar des Verbands aus ${b.name}` });
      continue;
    }
    // Drohnen nach Abschüssen: Sicht der verbliebenen Einheiten (returning hält den Bestand).
    if (p.sightKm > 0) out.push({ ...common, kind: "patrouille", km: p.sightKm, label: `Patrouille aus ${b.name}` });
    if (p.sonarKm > 0) out.push({ ...common, kind: "sonar", km: p.sonarKm, label: `Sonar der Patrouille aus ${b.name}` });
  }
  if (ib.post) {
    const posts = await db.select().from(tables.radarPost).where(inArray(tables.radarPost.playerId, members));
    for (const p of posts) {
      if (p.offline) continue;
      out.push({ kind: "posten", km: ib.post.rangeKm, ...hexCenterXY(p.col, p.row), col: p.col, row: p.row, baseId: p.baseId, playerId: p.playerId, label: `Radarposten ${p.col}/${p.row}` });
    }
  }
  return out;
}
