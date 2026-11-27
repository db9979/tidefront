// KI-Spieler und Lagebild: Bots sehen genau so viel wie Menschen (dieselbe Kartenansicht, gleiche Sensoren und
// gespeichertes Wissen). Stufe 2: Aufklärung mit Kampagnen (bis zu 4 Ziele je Fahrt) und Patrouillen.
// - Freibeuter: klärt unbekannte Nester und Felder laufend auf (Kampagne), dazu Patrouillen vor den eigenen Zielen.
// - Festung: klärt Nester in Reichweite auf, sobald sie keine bekannten mehr hat (Kampagne, höchstens alle 6 h).
// - Händler: sparsam, höchstens einmal am Tag, Felder und Nester (er überfällt nur leichte Nester, bots.profiles.nestMaxLevel).
import { hexCenterXY, hexDistanceKm, hexAtXY, inGrid, terrainAt } from "@tidefront/world";
import { activeSatellites, campaignOf, missionSlots, patrolOf, satelliteLaunchCheck, satelliteOf, type BaseState } from "@tidefront/game-core";
import { balance } from "./context.ts";
import { launchMission, type LaunchInput } from "./commands.ts";
import { missionPreview } from "./views.ts";
import { mapViewFor } from "./intel-map.ts";
import { botsConfig } from "./bots-core.ts";
import { launchIntelOp, previewIntelOp } from "./intel-ops.ts";
import type { TurnCtx } from "./bots-war.ts";
import { activeMissionCount, basesOfPlayer, homeBaseOf, type BaseRow } from "./store.ts";
import { launchSatellite } from "./intel-sat.ts";

export type BotMap = Awaited<ReturnType<typeof mapViewFor>>;

const maps = new WeakMap<TurnCtx, BotMap>();
const HOUR_MS = 3600000;

/** Kartenansicht des Bots, einmal je Zug (speichert auch seine Live-Sichtungen wie bei Menschen). */
export async function botMap(c: TurnCtx): Promise<BotMap> {
  const hit = maps.get(c);
  if (hit) return hit;
  const v = await mapViewFor(c.engine.db, c.bot.id, c.nowMs);
  maps.set(c, v);
  return v;
}

/** Pause zwischen zwei Aufklärungsfahrten je Spielweise (Stunden); null = klärt diese Zielart nicht auf. */
function reconPause(c: TurnCtx, what: "nest" | "field"): number | null {
  if (c.bot.profile === "freibeuter") return 0;
  if (c.bot.profile === "festung") return what === "nest" ? 6 : 12;
  if (c.bot.profile === "haendler") return 24; // Felder und (für leichte Überfälle) Nester, höchstens einmal am Tag
  return null;
}

/** Klärt der Bot unbekannte Ziele dieser Art jetzt auf? (Spielweise und Pause seit der letzten Fahrt.) */
export function scoutsUnknown(c: TurnCtx, what: "nest" | "field" = "nest"): boolean {
  const pause = reconPause(c, what);
  if (pause === null) return false;
  const last = c.state.recon?.[`trip-${what}`] ?? 0;
  return c.nowMs - last >= pause * HOUR_MS;
}

/** Aufklärer: Drohne, sonst Korvette (je ein Stück), sonst null. */
function scoutUnit(state: BaseState): string | null {
  if ((state.units.aufklaerungsdrohne ?? 0) > 0) return "aufklaerungsdrohne";
  if ((state.units.korvette ?? 0) > 0) return "korvette";
  return null;
}

/**
 * Aufklärung der nächsten unbekannten Ziele in Reichweite (je Ziel höchstens einmal je reconMaxAgeHours): mehrere
 * Ziele als Kampagne (bis campaign.maxTargets), ein Ziel als einfache Aufklärung. key unterscheidet Ziele im
 * Bot-Zustand (z. B. "n12" für Nest 12, "f3" für Feld 3); what: Zielart für die Pause je Spielweise.
 */
export async function scoutNearest(
  c: TurnCtx,
  base: BaseRow & { state: BaseState },
  targets: { key: string; col: number; row: number; fieldId?: number; label: string }[],
  rangeKm: number,
  what: "nest" | "field" = "nest",
): Promise<boolean> {
  const unit = scoutUnit(base.state);
  if (!unit) return false;
  const maxAge = botsConfig().reconMaxAgeHours * HOUR_MS;
  const limit = unit === "aufklaerungsdrohne" ? Math.min(rangeKm, balance.units.aufklaerungsdrohne?.rangeKm ?? rangeKm) : rangeKm;
  const open = targets
    .filter((t) => { const sent = c.state.recon?.[t.key]; return !sent || c.nowMs - sent >= maxAge; })
    .map((t) => ({ ...t, d: hexDistanceKm(base, t) }))
    .filter((t) => t.d <= limit)
    .sort((a, b) => a.d - b.d);
  const max = campaignOf(balance.intel)?.maxTargets ?? 1;
  const mark = (list: typeof open) => {
    c.state.recon = { ...(c.state.recon ?? {}), [`trip-${what}`]: c.nowMs };
    for (const t of list) c.state.recon[t.key] = c.nowMs;
  };
  if (open.length >= 2 && max > 1) {
    // Kampagne: nahe Ziele zuerst, je Abschnitt das nächste noch offene (kurze Runde).
    const route = [open[0]];
    const rest = open.slice(1, 8);
    while (route.length < max && rest.length > 0) {
      const last = route[route.length - 1];
      rest.sort((a, b) => hexDistanceKm(last, a) - hexDistanceKm(last, b));
      route.push(rest.shift()!);
    }
    const input = { op: "kampagne" as const, units: { [unit]: 1 }, targets: route.map((t) => ({ col: t.col, row: t.row })), baseId: base.id };
    if ((await previewIntelOp(c.engine, c.bot.id, input)).ok) {
      const r = await launchIntelOp(c.engine, c.bot.id, c.key("campaign"), input);
      if (r.ok) {
        mark(route);
        c.log.push(`Aufklärungskampagne: ${route.length} Ziele (${route.map((t) => t.label).join(", ")}).`);
        return true;
      }
    }
  }
  for (const t of open.slice(0, 3)) {
    const input: LaunchInput = { type: "aufklaerung", units: { [unit]: 1 }, col: t.col, row: t.row, baseId: base.id, ...(t.fieldId !== undefined ? { fieldId: t.fieldId } : {}) };
    if (!(await missionPreview(c.engine, c.bot.id, input)).ok) continue;
    const r = await launchMission(c.engine, c.bot.id, c.key("scout"), input);
    if (!r.ok) continue;
    mark([t]);
    c.log.push(`Aufklärung: ${t.label} (${Math.round(t.d)} km, Lage unbekannt).`);
    return true;
  }
  return false;
}

/** Nächstes Seefeld zu einem Feld (Wegpunkt einer Patrouille), bis 2 Felder entfernt. */
function seaNear(col: number, row: number): { col: number; row: number } | null {
  for (let r = 0; r <= 2; r++) for (let dc = -r; dc <= r; dc++) for (let dr = -r; dr <= r; dr++) {
    const h = { col: col + dc, row: row + dr };
    if (inGrid(h.col, h.row) && terrainAt(h.col, h.row) === "sea") return h;
  }
  return null;
}

/**
 * Freibeuter: Patrouille (Korvetten, höchstens alle 24 h) über unbekannte oder veraltete Nester in 150–600 km, damit Ziele und
 * fremde Verbände in Sicht kommen. Wegpunkte auf See nahe den Nestern; 4 h auf Station. Nur mit mindestens zwei freien
 * Auftragsplätzen (einer bleibt für Überfälle); bots-run.ts ruft sie erst, wenn in diesem Zug kein Angriff möglich war.
 */
export async function botPatrol(c: TurnCtx, base: BaseRow & { state: BaseState }): Promise<boolean> {
  const pb = patrolOf(balance.intel);
  if (!pb || c.bot.profile !== "freibeuter" || (base.state.units.korvette ?? 0) < 4) return false;
  if (c.nowMs - (c.state.recon?.["trip-patrol"] ?? 0) < 24 * HOUR_MS) return false;
  if (missionSlots(base.state, balance) - (await activeMissionCount(c.engine.db, base.id)) < 2) return false;
  const map = await botMap(c);
  const unknown = map.nests.filter((n) => !n.known || n.intel?.age === "veraltet").map((n) => ({ ...n, d: hexDistanceKm(base, n) })).filter((n) => n.d >= 150 && n.d <= 600).sort((a, b) => a.d - b.d);
  if (unknown.length === 0) return false;
  const first = unknown[0];
  const second = unknown.find((n) => n !== first && hexDistanceKm(first, n) >= 150 && hexDistanceKm(first, n) <= 400);
  const a = seaNear(first.col, first.row);
  let b = second ? seaNear(second.col, second.row) : null;
  if (!b && a) {
    // Zweiter Wegpunkt: 200 km quer zur Richtung Hafen → erstes Nest.
    const p = hexCenterXY(a.col, a.row);
    const h = hexCenterXY(base.col, base.row);
    const len = Math.hypot(p.x - h.x, p.y - h.y) || 1;
    const q = hexAtXY(p.x + ((h.y - p.y) / len) * 200, p.y - ((h.x - p.x) / len) * 200);
    b = seaNear(q.col, q.row);
  }
  if (!a || !b || (a.col === b.col && a.row === b.row)) return false;
  const input = { op: "patrouille" as const, units: { korvette: 2 }, waypoints: [a, b], hours: pb.hours[0], baseId: base.id };
  if (!(await previewIntelOp(c.engine, c.bot.id, input)).ok) return false;
  const r = await launchIntelOp(c.engine, c.bot.id, c.key("patrol"), input);
  if (!r.ok) return false;
  c.state.recon = { ...(c.state.recon ?? {}), "trip-patrol": c.nowMs };
  c.log.push(`Patrouille mit 2 Korvetten (${pb.hours[0]} h) vor unbekannten Nestern.`);
  return true;
}

/**
 * Stufe 3: Satellit starten, wenn es sich lohnt – Freibeuter (und Festung) mit Startrampe und Raumfahrt, wenn kein
 * eigener Satellit fliegt (bzw. die Höchstzahl nicht erreicht ist), mindestens 4 Nester in 1 500 km unbekannt oder
 * veraltet sind und nach dem Start noch einmal die Startkosten im Lager bleiben. Optisch zuerst, sonst Radar.
 */
export async function botSatellite(c: TurnCtx, base: BaseRow & { state: BaseState }): Promise<boolean> {
  const sb = satelliteOf(balance.intel);
  if (!sb || (c.bot.profile !== "freibeuter" && c.bot.profile !== "festung")) return false;
  if ((base.state.buildings[sb.launchpad] ?? 0) < 1) return false;
  if (c.nowMs - (c.state.recon?.["trip-satellite"] ?? 0) < 6 * HOUR_MS) return false;
  const home = await homeBaseOf(c.engine.db, c.bot.id);
  const techs = home?.state.research?.levels ?? {};
  const active = (await basesOfPlayer(c.engine.db, c.bot.id)).flatMap((b) => activeSatellites(b.state, c.nowMs));
  const map = await botMap(c);
  const unknown = map.nests.filter((n) => (!n.known || n.intel?.age === "veraltet") && hexDistanceKm(base, n) <= 1500).length;
  if (unknown < 4) return false;
  const order: ("optisch" | "radar")[] = active.some((s) => s.type === "optisch") ? ["radar"] : ["optisch", "radar"];
  for (const type of order) {
    const chk = satelliteLaunchCheck(base.state, type, techs, active.length, balance);
    if (!chk.ok) continue;
    // Reserve: nach dem Start bleiben noch einmal die Startkosten (sonst fehlt das Geld für Flotte und Ausbau).
    if (Object.entries(chk.cost).some(([r, v]) => (base.state.resources[r] ?? 0) < 2 * v)) continue;
    const r = await launchSatellite(c.engine, c.bot.id, c.key("satellite"), { type, baseId: base.id });
    if (!r.ok) continue;
    c.state.recon = { ...(c.state.recon ?? {}), "trip-satellite": c.nowMs };
    c.log.push(`${type === "optisch" ? "Optischer Satellit" : "Radarsatellit"} gestartet (${unknown} Nester ohne Lagebild in 1 500 km).`);
    return true;
  }
  return false;
}
