// Bausteine für Abhilfe-Hinweise: Stufen, fehlende Ressourcen, Sprungziele. Werte stets aus Balance und Hafenansicht.
import type { BaseState, Balance as CoreBalance } from "@tidefront/game-core";
import type { BaseData } from "../trpc.ts";
import { fmtNum, label } from "../names.ts";
import { fmtDuration } from "../time.ts";
import type { NavTarget, Remedy, RemedyAction, RemedyCtx } from "./types.ts";

/** Stufe eines Gebäudes im aktiven Hafen. */
export function lvl(base: BaseData | null, id: string): number {
  return base?.buildings.find((b) => b.id === id)?.level ?? 0;
}

/** Hafenansicht als (schmaler) Hafenzustand für reine Regel-Funktionen aus game-core. */
export function stateOf(base: BaseData, levels: Record<string, number> = {}): BaseState {
  return {
    buildings: { ...Object.fromEntries(base.buildings.map((b) => [b.id, b.level])), ...levels },
    units: Object.fromEntries(base.units.map((u) => [u.id, u.home])),
    unitsAway: Object.fromEntries(base.units.map((u) => [u.id, u.away])),
    trainingQueue: base.trainingQueue,
    buildQueue: base.buildQueue,
    resources: base.resources,
  } as unknown as BaseState;
}

/** Kleinste Stufe über `from`, bei der `value(stufe)` größer ist als `value(from)` (null: keine bis zur Höchststufe). */
export function nextStep(from: number, max: number, value: (level: number) => number): { level: number; value: number } | null {
  const now = value(from);
  for (let l = from + 1; l <= max; l++) {
    const v = value(l);
    if (v > now) return { level: l, value: v };
  }
  return null;
}

export const go = (label: string, target: NavTarget): RemedyAction => ({ label, go: target });
export const build = (id: string, text = `${label(id)} ausbauen`): RemedyAction => go(text, { to: "building", id });
export const research: RemedyAction = go("Forschung", { to: "research" });
export const missions: RemedyAction = go("Laufende Missionen", { to: "troops", seg: "einsatz" });
export const training: RemedyAction = go("Ausbilden", { to: "troops", seg: "ausbilden" });
export const mapAction: RemedyAction = go("Zur Karte", { to: "map" });
export const alliance: RemedyAction = go("Allianz", { to: "meldungen", sub: "allianz" });
export const market = (resource?: string): RemedyAction =>
  go(resource ? `${label(resource)} an der Börse` : "Zur Börse", { to: "market", resource, seg: "handel" });

/** Produktionsgebäude einer Ressource (balance.buildings[*].produces). */
export function producer(balance: CoreBalance | null, resource: string): string | null {
  if (!balance) return null;
  for (const [id, def] of Object.entries(balance.buildings)) if ((def as { produces?: string }).produces === resource) return id;
  return null;
}

/** Stufe der Hafenkommandantur, ab der die Börse öffnet. */
export function marketLevel(balance: CoreBalance | null): number {
  return balance?.buildings.hafenkommandantur?.marketFromLevel ?? 3;
}

/** Liste „a, b und c“. */
export function joinDe(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}

/**
 * Fehlende Ressourcen für `cost`: wie viel fehlt, wann es bei aktueller Förderung da ist, ob das Lager reicht,
 * und Sprünge zur Börse (Ressource vorgewählt) und zum Produktionsgebäude.
 */
export function missingResources(ctx: RemedyCtx, cost: Record<string, number> | null | undefined): Remedy {
  const { base, balance } = ctx;
  if (!base || !cost) {
    return {
      hint: "Ressourcen fehlen. Warte auf die Förderung, baue die Produktion aus oder kaufe an der Börse zu.",
      actions: [market()],
    };
  }
  const missing = Object.entries(cost)
    .map(([r, need]) => ({ r, need, lack: Math.ceil(need - (base.resources[r] ?? 0)) }))
    .filter((x) => x.lack > 0);
  if (missing.length === 0) {
    return { hint: "Die Bestände reichen inzwischen – bitte erneut versuchen.", actions: [] };
  }
  const parts: string[] = [];
  // Wartezeit bei aktueller Förderung (je Stunde, nach Strom und Unterhalt).
  const goods = missing.filter((m) => m.r !== "credits"); // Kredite fördert kein Gebäude
  const rateOf = (r: string) => (base.rates as Record<string, number>)[r] ?? 0;
  const waitOf = (m: { r: string; lack: number }) => (rateOf(m.r) > 0 ? (m.lack / rateOf(m.r)) * 3_600_000 : Infinity);
  const wait = Math.max(0, ...goods.map(waitOf));
  if (goods.length > 0 && !Number.isFinite(wait)) parts.push("Ohne Förderung kommt es nicht von selbst – Produktion ausbauen oder zukaufen.");
  if (goods.length < missing.length) parts.push("Kredite bringen Verkäufe an der Börse oder im Spielerhandel.");
  const overCap = missing.filter((m) => (cost[m.r] ?? 0) > base.capacity);
  if (overCap.length > 0) parts.push(`Das Lager fasst nur ${fmtNum(Math.floor(base.capacity))} ${label(overCap[0].r)} – erst den Lagerkomplex ausbauen.`);
  const open = base.market.unlocked;
  parts.push(open ? (Number.isFinite(wait) && goods.length > 0 ? "Warten oder an der Börse zukaufen." : "Schneller geht es an der Börse.") : `Die Börse öffnet ab Hafenkommandantur Stufe ${marketLevel(balance)}.`);
  const items = missing.map((m) => {
    const w = m.r === "credits" ? Infinity : waitOf(m);
    return { id: m.r, label: label(m.r), have: Math.floor(base.resources[m.r] ?? 0), need: Math.ceil(m.need), eta: Number.isFinite(w) ? `in ca. ${fmtDuration(w)}` : undefined };
  });
  const summary = `Fehlt: ${joinDe(missing.map((m) => `${fmtNum(m.lack)} ${label(m.r)}`))}${goods.length > 0 && Number.isFinite(wait) ? ` · ca. ${fmtDuration(wait)}` : ""}`;
  const actions: RemedyAction[] = [];
  if (overCap.length > 0) actions.push(build("lagerkomplex"));
  // Börse nur anbieten, wenn sie offen ist; sonst führt der Weg über die Hafenkommandantur.
  if (open) for (const m of goods.slice(0, 2)) actions.push(market(m.r));
  else if (goods.length > 0) actions.push(build("hafenkommandantur"));
  if (goods.length < missing.length) actions.push(open ? market() : build("hafenkommandantur"));
  const prod = goods[0] ? producer(balance, goods[0].r) : null;
  if (prod) actions.push(build(prod));
  return { hint: parts.join(" "), summary, items, actions: dedupe(actions) };
}

/** Gleiche Sprünge nur einmal (z. B. zweimal „Zur Börse“). */
export function dedupe(actions: RemedyAction[]): RemedyAction[] {
  const seen = new Set<string>();
  return actions.filter((a) => {
    const k = JSON.stringify(a.go);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
