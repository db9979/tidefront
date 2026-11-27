// Lagezentrum (Meldungen → Lage): alles, was für den Spieler zeitlich ansteht, über alle eigenen Häfen gebündelt.
// Eine schlanke Abfrage statt vieler: liest nur gespeicherte Zeilen (Häfen, Missionen, Konvois, Lieferungen,
// Verträge, Weltereignisse) und rechnet nichts neu, was nicht billig ist (kein processDue, kein Kampf, keine Karte).
// brief: nur die Zahl fürs Navigationszeichen (Angriffe, Nachfristen, leere Bauschlangen, abholbare Belohnungen).
// Entscheidung „Lagezentrum“ (packages/game-core/ENTSCHEIDUNGEN-5.md).
import { and, eq, gt, inArray, notInArray, or } from "drizzle-orm";
import { activeSatellites, nextPass, nightShieldWindow, radarWarningMinutes, type Mission, type Modifiers, type ResourceMap } from "@tidefront/game-core";
import { COLS, HEX_W, tradePortNameAt } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { basesOfPlayer, ADMIRAL_RETURN_TYPE, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { detectIncoming, detectedAtOf } from "./radar.ts";
import { OWN_BASE_TARGET } from "./expansion.ts";
import { RUNNING } from "./contracts-core.ts";
import { openWorldEvents } from "./world-events.ts";
import { runningSeason } from "./season.ts";
import { amounts, clock, countsText, fmtInt, minutesText, nameOf } from "./names.ts";
import { harborSub, row, SOON_MS, type LageRow, type LageUrgent } from "./lage-types.ts";
import { waitingRows } from "./lage-wait.ts";
import { allianceRows, beginnerRow, rewardSourceCounts } from "./lage-social.ts"; // TST-15, TX-08, TST-16

export type { LageJump, LageRow, LageUrgent } from "./lage-types.ts";

const MAP_WIDTH_KM = (COLS + 0.5) * HEX_W; // wie intel-sat.ts
const ACTIVE_MISSION = ["outbound", "returning", "staged", "stationed", "holding"];
const CONVOY_TEXT: Record<string, string> = { boerse: "Börsenlieferung", vertrag: "Vertragslieferung", handel: "Handelslieferung", feld: "Feldertrag", transport: "Transport" };

export interface LageView {
  serverNow: number;
  /** Gleich / heute: Termine der nächsten 24 h, Angriffe zuerst. */
  soon: LageRow[];
  /** Unterwegs: eigene Verbände und Konvois mit Fortschritt. */
  underway: LageRow[];
  /** Wartet auf dich: Zustände, die eine Handlung brauchen. */
  waiting: LageRow[];
  urgent: LageUrgent;
}

/** Lagezentrum eines Spielers. brief: nur `urgent` (Navigationszeichen), Listen bleiben leer. */
export async function lageView(engine: Engine, playerId: number, opts: { brief?: boolean } = {}): Promise<LageView> {
  const nowMs = Date.now();
  const db = engine.db;
  const bases = await basesOfPlayer(db, playerId);
  const empty: LageView = { serverNow: nowMs, soon: [], underway: [], waiting: [], urgent: { attacks: 0, grace: 0, idleQueues: 0, rewards: 0, keys: [] } };
  if (bases.length === 0) return empty;
  const mods = new Map<number, Modifiers>();
  for (const b of bases) mods.set(b.id, await modsOf(db, b, nowMs));

  const attacks = await attackRows(db, bases, mods, nowMs);
  const contracts = await contractRows(db, playerId, nowMs);
  const rewardSources = await rewardSourceCounts(db, playerId);
  const rewards = rewardSources.achievements + rewardSources.weekly;
  const idle = bases.filter((b) => b.state.buildQueue.length === 0);
  const grace = contracts.filter((r) => r.kind === "nachfrist");
  const beginner = beginnerRow(bases, nowMs); // TX-08: Anfängerschutz endet (letzte 24 h)
  const keys = [...attacks.map((r) => r.key), ...grace.map((r) => r.key), ...idle.map((b) => `leer:${b.id}`), ...(rewards > 0 ? [`belohnungen:${rewards}`] : []),
    ...(beginner ? [beginner.key] : [])];
  const urgent: LageUrgent = { attacks: attacks.length, grace: grace.length, idleQueues: idle.length, rewards, rewardSources, keys };
  if (opts.brief) {
    // TST-15: offene Beitrittsanfragen zählen fürs Navigationszeichen (Schlüssel je neuester Anfrage).
    for (const r of await allianceRows(db, playerId)) if (r.urgent) urgent.keys.push(r.key);
    return { ...empty, urgent };
  }

  const soon: LageRow[] = [...attacks, ...contracts, ...(beginner ? [beginner] : [])];
  const underway: LageRow[] = [];
  await missionRows(db, playerId, bases, nowMs, soon, underway);
  await convoyRows(db, playerId, bases, nowMs, soon, underway);
  soon.push(...queueRows(bases), ...(await worldRows(db, bases, nowMs)));
  const inWindow = soon.filter((r) => r.atMs !== null && r.atMs > nowMs - 5000 && (r.kind === "angriff" || r.atMs <= nowMs + SOON_MS));
  inWindow.sort((a, b) => Number(b.kind === "angriff") - Number(a.kind === "angriff") || a.atMs! - b.atMs! || a.key.localeCompare(b.key));
  underway.sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity) || a.key.localeCompare(b.key));
  const waiting = await waitingRows(db, playerId, bases, mods, nowMs, rewardSources);
  for (const r of waiting) if (r.kind === "beitritt") urgent.keys.push(r.key); // TST-15: Zahl am Navigationszeichen
  return { serverNow: nowMs, soon: inWindow, underway, waiting, urgent };
}

/** Erkannte Angriffe auf eigene Häfen (Radar wie baseView; markiert neu Erkannte). */
async function attackRows(db: DbOrTx, bases: BaseRow[], mods: Map<number, Modifiers>, nowMs: number): Promise<LageRow[]> {
  const t = tables.mission;
  const rows = await db.select({ id: t.id, type: t.type, targetId: t.targetId, playerId: t.playerId, arriveAt: t.arriveAt, plan: t.plan }).from(t).where(and(
    eq(t.targetKind, "base"), inArray(t.targetId, bases.map((b) => b.id)), eq(t.status, "outbound"),
    notInArray(t.type, ["transport", "spionage"]),
  ));
  const out: LageRow[] = [];
  for (const b of bases) {
    const mine = rows.filter((m) => m.targetId === b.id && m.playerId !== b.playerId);
    if (mine.length === 0) continue;
    const seen = await detectIncoming(db, mine, nowMs, radarWarningMinutes(b.state, balance, mods.get(b.id)));
    for (const m of seen) {
      const at = m.arriveAt.getTime();
      const detected = detectedAtOf(m.plan) ?? nowMs;
      out.push(row({
        key: `angriff:${m.id}`, kind: "angriff", atMs: at, icon: m.type === "kartell" ? "kartell" : "ueberfall", tone: "alarm", urgent: true,
        text: `${nameOf(m.type)} auf ${b.name}`,
        sub: `Erkannt ${clock(detected)} Uhr · Vorwarnzeit ${minutesText(at - detected)} · Ankunft ${clock(at)} Uhr`,
        jump: { to: "base", baseId: b.id },
      }));
    }
  }
  return out;
}

/** Laufende Lieferverträge: Fälligkeit und Nachfrist (Nachfrist ist dringend). */
async function contractRows(db: DbOrTx, playerId: number, nowMs: number): Promise<LageRow[]> {
  const t = tables.marketContract;
  const rows = await db.select({ id: t.id, status: t.status, resource: t.resource, qty: t.qty, buyerId: t.buyerId, dueAt: t.dueAt, graceUntil: t.graceUntil })
    .from(t).where(and(inArray(t.status, RUNNING), or(eq(t.buyerId, playerId), eq(t.sellerId, playerId))));
  return rows.map((c) => {
    const what = `${fmtInt(c.qty)} ${nameOf(c.resource)} (${c.buyerId === playerId ? "Kauf" : "Verkauf"})`;
    if (c.status === "nachfrist") {
      return row({ key: `nachfrist:${c.id}`, kind: "nachfrist", atMs: c.graceUntil?.getTime() ?? nowMs, icon: c.resource, tone: "alarm", urgent: true,
        text: `Nachfrist endet: ${what}`, sub: "Liefervertrag – Ware oder Taler bereitstellen, sonst wird anteilig erfüllt", jump: { to: "contracts" } });
    }
    return row({ key: `vertrag:${c.id}`, kind: "vertrag", atMs: c.dueAt.getTime(), icon: c.resource, text: `Liefervertrag fällig: ${what}`, jump: { to: "contracts" } });
  });
}

function targetText(m: { targetKind: string; targetCol: number; targetRow: number; targetId: number | null }, names: Map<number, string>): string {
  if ((m.targetKind === "base" || m.targetKind === OWN_BASE_TARGET) && m.targetId !== null && names.has(m.targetId)) return names.get(m.targetId)!;
  if (m.targetKind === "nest") return "Piratennest";
  if (m.targetKind === "field") return "Rohstofffeld";
  if (m.targetKind === "convoy") return "Konvoi";
  if (m.targetKind === "event") return "Weltereignis";
  return `Feld ${m.targetCol}/${m.targetRow}`;
}

/** Eigene Verbände: Ankunft/Rückkehr (Gleich) und Fortschritt (Unterwegs). */
async function missionRows(db: DbOrTx, playerId: number, bases: BaseRow[], nowMs: number, soon: LageRow[], underway: LageRow[]) {
  const t = tables.mission;
  const rows = await db.select().from(t).where(and(eq(t.playerId, playerId), inArray(t.status, ACTIVE_MISSION)));
  const ids = [...new Set(rows.filter((m) => m.targetKind === "base" || m.targetKind === OWN_BASE_TARGET).map((m) => m.targetId).filter((x): x is number => x !== null))];
  const names = new Map(ids.length === 0 ? [] : (await db.select({ id: tables.base.id, name: tables.base.name }).from(tables.base).where(inArray(tables.base.id, ids))).map((b) => [b.id, b.name]));
  for (const m of rows) {
    if (m.type === ADMIRAL_RETURN_TYPE) continue;
    const plan = m.plan as Mission;
    const what = `${nameOf(m.type)}: ${targetText(m, names)}`;
    const arrive = m.arriveAt.getTime();
    const back = m.returnAt?.getTime() ?? plan.returnAtMs ?? null;
    const jump = { to: "map" as const, col: m.targetCol, row: m.targetRow, baseId: m.baseId, missionId: m.id };
    const sub = [countsText(plan.units), harborSub(bases, m.baseId)].filter(Boolean).join(" · ") || null;
    const outbound = m.status === "outbound";
    if (outbound) soon.push(row({ key: `ankunft:${m.id}`, kind: "ankunft", atMs: arrive, icon: m.type, text: `${what} – Ankunft`, sub, jump }));
    if ((outbound || m.status === "returning") && back !== null) {
      soon.push(row({ key: `rueckkehr:${m.id}`, kind: "rueckkehr", atMs: back, icon: m.type, text: `${what} – Verband zurück`, sub, jump }));
    }
    const depart = plan.departAtMs ?? m.createdAt.getTime();
    const turn = plan.recalledAtMs ?? arrive;
    const progress = outbound ? { fromMs: depart, toMs: arrive } : m.status === "returning" && back !== null ? { fromMs: turn, toMs: back } : null;
    const state = outbound ? "Hinweg" : m.status === "returning" ? "Rückweg" : m.status === "staged" ? "wartet auf Abfahrt" : "vor Ort";
    underway.push(row({ key: `verband:${m.id}`, kind: "verband", atMs: outbound ? arrive : back, icon: m.type, text: what, sub: [state, sub].filter(Boolean).join(" · "), progress, jump }));
  }
}

/** Eigene Konvois (Empfänger oder Absender) und Lieferungen ohne Konvoi. Transporte stehen schon als Verband da. */
async function convoyRows(db: DbOrTx, playerId: number, bases: BaseRow[], nowMs: number, soon: LageRow[], underway: LageRow[]) {
  const t = tables.convoy;
  const rows = await db.select().from(t).where(and(eq(t.status, "underway"), gt(t.arriveAt, new Date(nowMs)), or(eq(t.recipientId, playerId), eq(t.senderId, playerId))));
  const others = [...new Set(rows.flatMap((c) => [c.senderId, c.recipientId]).filter((x): x is number => x !== null && x !== playerId))];
  const names = new Map(others.length === 0 ? [] : (await db.select({ id: tables.player.id, name: tables.player.name }).from(tables.player).where(inArray(tables.player.id, others))).map((p) => [p.id, p.name]));
  for (const c of rows) {
    if (c.kind === "transport") continue;
    const incoming = c.recipientId === playerId;
    const cargo = amounts(c.cargo as ResourceMap);
    const label = CONVOY_TEXT[c.kind] ?? "Konvoi";
    const from = c.senderId === null ? `Handelshafen ${tradePortNameAt(c.fromCol, c.fromRow) ?? "?"}` : names.get(c.senderId) ?? "?";
    const sub = incoming
      ? [`von ${from}`, harborSub(bases, c.recipientBaseId)].filter(Boolean).join(" · ")
      : `an ${names.get(c.recipientId) ?? "?"}`;
    const icon = Object.keys(c.cargo as ResourceMap)[0] ?? "konvoi";
    const at = c.arriveAt.getTime();
    const jump = { to: "map" as const, col: c.toCol, row: c.toRow, baseId: incoming ? c.recipientBaseId : null, convoyId: c.id };
    soon.push(row({ key: `konvoi:${c.id}`, kind: "konvoi", atMs: at, icon, text: `${label} trifft ein: ${cargo}`, sub, jump }));
    underway.push(row({ key: `konvoi-weg:${c.id}`, kind: "konvoi", atMs: at, icon: "konvoi", text: `${label}: ${cargo}`, sub, progress: { fromMs: c.departAt.getTime(), toMs: at }, jump }));
  }
  const convoyDeliveries = new Set(rows.map((c) => c.deliveryId).filter((x): x is string => x !== null));
  const d = tables.delivery;
  const loose = await db.select().from(d).where(and(eq(d.playerId, playerId), eq(d.status, "underway"), gt(d.arriveAt, new Date(nowMs))));
  for (const x of loose) {
    if (convoyDeliveries.has(x.id)) continue;
    const at = x.arriveAt.getTime();
    soon.push(row({ key: `lieferung:${x.id}`, kind: "lieferung", atMs: at, icon: x.resource, text: `Lieferung trifft ein: ${fmtInt(x.qty)} ${nameOf(x.resource)}`, sub: harborSub(bases, x.baseId), jump: { to: "base", baseId: x.baseId } }));
    // Auch Lieferungen ohne Konvoi (vor 0.33 gekauft) stehen unter „Unterwegs“ – mit Fortschritt, gleich wie lange noch.
    underway.push(row({ key: `lieferung-weg:${x.id}`, kind: "lieferung", atMs: at, icon: x.resource, text: `Lieferung: ${fmtInt(x.qty)} ${nameOf(x.resource)}`, sub: harborSub(bases, x.baseId), progress: { fromMs: x.departAt.getTime(), toMs: at }, jump: { to: "base", baseId: x.baseId } }));
  }
}

/** Fertigstellungen: Bau, Ausbildung je Hafen, Forschung (Heimathafen). */
function queueRows(bases: BaseRow[]): LageRow[] {
  const out: LageRow[] = [];
  for (const b of bases) {
    const sub = harborSub(bases, b.id);
    for (const o of b.state.buildQueue) {
      out.push(row({ key: `bau:${b.id}:${o.buildingId}:${o.targetLevel}`, kind: "bau", atMs: o.finishesAt, icon: o.buildingId, text: `${nameOf(o.buildingId)} Stufe ${o.targetLevel} fertig`, sub, jump: { to: "building", baseId: b.id, id: o.buildingId } }));
    }
    for (const o of b.state.trainingQueue) {
      out.push(row({ key: `ausbildung:${b.id}:${o.builtIn}:${o.id}:${o.finishesAt}`, kind: "ausbildung", atMs: o.finishesAt, icon: o.id, text: `${countsText({ [o.id]: o.count })} ausgebildet`, sub, jump: { to: "troops", baseId: b.id, seg: o.kind === "defense" ? "abwehr" : "ausbilden" } }));
    }
    const r = b.isHome ? b.state.research?.order : null;
    if (r) out.push(row({ key: `forschung:${r.techId}:${r.targetLevel}`, kind: "forschung", atMs: r.finishesAt, icon: "forschungsamt", text: `Forschung ${nameOf(r.techId)} Stufe ${r.targetLevel} fertig`, jump: { to: "research" } }));
  }
  return out;
}

/** Nachtschild, Satellitenüberflug, Weltereignisse und Saisonende. */
async function worldRows(db: DbOrTx, bases: BaseRow[], nowMs: number): Promise<LageRow[]> {
  const out: LageRow[] = [];
  const home = bases.find((b) => b.isHome) ?? bases[0];
  const w = nightShieldWindow(home.state.protection, nowMs, balance);
  if (w && nowMs < w.startMs) out.push(row({ key: "nachtschild:start", kind: "nachtschild", atMs: w.startMs, icon: "schild", text: "Nachtschild beginnt", jump: { to: "base", baseId: home.id } }));
  else if (w && nowMs < w.endMs) out.push(row({ key: "nachtschild:ende", kind: "nachtschild", atMs: w.endMs, icon: "schild", text: "Nachtschild endet", jump: { to: "base", baseId: home.id } }));
  for (const b of bases) {
    for (const s of activeSatellites(b.state, nowMs)) {
      const p = nextPass(s, nowMs, MAP_WIDTH_KM);
      if (p) out.push(row({ key: `satellit:${b.id}:${s.id}:${p.k}`, kind: "satellit", atMs: p.startMs, icon: "satellit", text: `Satellitenüberflug (${nameOf(s.type === "radar" ? "radarsatellit" : "optischer_satellit")})`, sub: harborSub(bases, b.id), jump: { to: "map", col: b.col, row: b.row, baseId: b.id } }));
    }
  }
  for (const e of await openWorldEvents(db)) {
    const own = e.targetBaseId !== null && bases.some((b) => b.id === e.targetBaseId);
    const jump = { to: "map" as const, col: e.col, row: e.row, baseId: null, eventId: e.id };
    const name = e.kind === "finale" ? "Saisonfinale: Kartell-Armada" : nameOf(e.kind);
    if (e.status === "announced") out.push(row({ key: `welt:${e.id}:start`, kind: "weltereignis", atMs: e.activeAt.getTime(), icon: "kartell", text: `${name} läuft aus`, sub: "Angekündigt", tone: own ? "alarm" : null, jump }));
    else out.push(row({ key: `welt:${e.id}:ende`, kind: "weltereignis", atMs: e.endsAt.getTime(), icon: "kartell", text: `${name} endet`, sub: own ? "Dein Hafen ist betroffen" : null, tone: own ? "alarm" : null, jump }));
  }
  const season = await runningSeason(db);
  if (season) out.push(row({ key: "saisonende", kind: "saison", atMs: season.endsAt.getTime(), icon: "uhr", text: "Saisonende" }));
  return out;
}

/** Kurzform für die Oberfläche ohne Hafen: leeres Lagezentrum. */
export const noLage = (nowMs: number): LageView => ({ serverNow: nowMs, soon: [], underway: [], waiting: [], urgent: { attacks: 0, grace: 0, idleQueues: 0, rewards: 0, keys: [] } });
