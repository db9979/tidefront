// Benachrichtigungen aus Ereignissen. Läuft in der Transaktion des Ereignisses (vor und nach dem Handler),
// versandt wird erst nach dem Commit (engine.push). Hält handlers.ts frei von Benachrichtigungslogik.
import { eq } from "drizzle-orm";
import { radarWarningMinutes, settle, type BaseState, type BuildOrder, type Modifiers, type TrainingOrder } from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import { balance, type NoticeJob } from "./context.ts";
import type { EventRow, Handler } from "./events.ts";
import { lockBase, readBase, scheduleEvent } from "./store.ts";
import { amounts, clock, fmtInt, minutesText, nameOf } from "./names.ts";
import { modsOf } from "./modifiers.ts";
import { detectedAtOf, isDetected, markDetected, warnFactor } from "./radar.ts";

export type Snapshot =
  | { kind: "build"; order: BuildOrder | null }
  | { kind: "training"; orders: TrainingOrder[] }
  | { kind: "mission"; status: string | null }
  | { kind: "delivery"; status: string | null }
  | null;

const MISSION_EVENTS = new Set(["mission_arrive", "mission_return", "raid_arrive"]);

/** Zustand vor dem Handler, soweit für die Meldung nötig. Sperrt in der üblichen Reihenfolge. */
export async function noticeSnapshot(tx: Tx, ev: EventRow): Promise<Snapshot> {
  if (ev.type === "build_complete" && ev.baseId) {
    const b = await lockBase(tx, ev.baseId);
    return { kind: "build", order: b?.state.buildQueue[0] ?? null };
  }
  if (ev.type === "training_complete" && ev.baseId) {
    const b = await lockBase(tx, ev.baseId);
    return { kind: "training", orders: b?.state.trainingQueue ?? [] };
  }
  if (MISSION_EVENTS.has(ev.type)) {
    const [m] = await tx
      .select({ status: tables.mission.status })
      .from(tables.mission)
      .where(eq(tables.mission.id, Number(ev.payload.missionId)));
    return { kind: "mission", status: m?.status ?? null };
  }
  if (ev.type === "delivery_arrive") {
    const [d] = await tx
      .select({ status: tables.delivery.status })
      .from(tables.delivery)
      .where(eq(tables.delivery.id, String(ev.payload.deliveryId)));
    return { kind: "delivery", status: d?.status ?? null };
  }
  return null;
}

async function reportNotices(tx: Tx, reportId: number): Promise<NoticeJob[]> {
  const [r] = await tx.select().from(tables.battleReport).where(eq(tables.battleReport.id, reportId));
  if (!r) return [];
  const data = r.report as { battle?: { loot?: Record<string, number> }; targetName?: string; attackerName?: string; from?: string };
  const loot = amounts(data.battle?.loot);
  const url = "/?tab=berichte";
  const tag = `report-${r.id}`;
  const out: NoticeJob[] = [];
  if (r.kind === "ueberfall" || r.kind === "kartell") {
    if (r.attackerPlayerId !== null) {
      const won = r.winner === "attacker";
      out.push({ playerId: r.attackerPlayerId, notice: {
        kind: "report", url, tag, title: `Kampfbericht: ${r.title}`,
        body: won ? `Sieg. Beute: ${loot}.` : "Der Angriff ist gescheitert.",
        facts: [["Ergebnis", won ? "Sieg" : "Niederlage"], ["Beute", loot]],
      } });
    }
    if (r.defenderPlayerId !== null) {
      const held = r.winner === "defender";
      const attacker = r.kind === "kartell" ? "Freibeuter-Kartell" : (data.attackerName ?? "Ein Gegner");
      out.push({ playerId: r.defenderPlayerId, notice: {
        kind: "report", url, tag, title: `Kampfbericht: ${data.targetName ?? "Dein Hafen"} angegriffen`,
        body: held ? `${attacker} wurde abgewehrt.` : `${attacker} hat deinen Hafen überwunden. Verlust: ${loot}.`,
        facts: [["Angreifer", attacker], ["Ergebnis", held ? "Abgewehrt" : "Verloren"], ["Beute des Gegners", loot]],
      } });
    }
  } else if (r.kind === "aufklaerung" || r.kind === "leer") {
    if (r.attackerPlayerId !== null) {
      out.push({ playerId: r.attackerPlayerId, notice: { kind: "report", url, tag, title: r.title, body: "Der Bericht liegt vor." } });
    }
  } else if (r.kind === "transport" && r.defenderPlayerId !== null) {
    out.push({ playerId: r.defenderPlayerId, notice: {
      kind: "delivery", url: "/?tab=basis", tag, title: "Transport angekommen",
      body: `${data.from ?? "Ein Mitspieler"} hat Ladung geliefert.`,
    } });
  }
  return out;
}

/** Meldungen nach dem Handler; vergleicht mit dem Zustand davor, damit nichts doppelt gemeldet wird. */
export async function noticesAfter(tx: Tx, ev: EventRow, due: number, snap: Snapshot): Promise<NoticeJob[]> {
  if (!snap) return [];
  if (snap.kind === "build") {
    if (!snap.order || snap.order.finishesAt > due) return [];
    const b = await readBase(tx, ev.baseId!);
    if (!b || (b.state.buildings[snap.order.buildingId] ?? 0) < snap.order.targetLevel) return [];
    const name = nameOf(snap.order.buildingId);
    return [{ playerId: b.playerId, notice: {
      kind: "build", url: "/?tab=basis", tag: `build-${b.id}`, title: "Ausbau fertig",
      body: `${name} ist jetzt auf Stufe ${snap.order.targetLevel}.`,
      facts: [["Gebäude", name], ["Stufe", String(snap.order.targetLevel)]],
    } }];
  }
  if (snap.kind === "training") {
    const b = await readBase(tx, ev.baseId!);
    if (!b) return [];
    const left = new Set(b.state.trainingQueue.map((o) => `${o.builtIn}|${o.id}|${o.finishesAt}`));
    const done = snap.orders.filter((o) => o.finishesAt <= due && !left.has(`${o.builtIn}|${o.id}|${o.finishesAt}`));
    if (done.length === 0) return [];
    const what = done.map((o) => `${fmtInt(o.count)} ${nameOf(o.id)}`).join(", ");
    return [{ playerId: b.playerId, notice: {
      kind: "training", url: "/?tab=truppen", tag: `training-${b.id}`, title: "Ausbildung fertig", body: `Bereit: ${what}.`,
    } }];
  }
  if (snap.kind === "delivery") {
    if (snap.status !== "underway") return [];
    const [d] = await tx.select().from(tables.delivery).where(eq(tables.delivery.id, String(ev.payload.deliveryId)));
    if (!d || d.status !== "delivered") return [];
    return [{ playerId: d.playerId, notice: {
      kind: "delivery", url: "/?tab=boerse", tag: `delivery-${d.id}`, title: "Lieferung angekommen",
      body: `${fmtInt(d.qty)} ${nameOf(d.resource)} sind im Hafen eingetroffen.`,
    } }];
  }
  // Missionen: nur bei einem Statuswechsel durch den Handler.
  if (snap.status === null) return [];
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, Number(ev.payload.missionId)));
  if (!m || m.status === snap.status) return [];
  if (ev.type === "mission_return" && m.status === "done" && m.playerId !== null && m.type === "spionage") return spyReturnNotice(tx, m);
  if (ev.type === "mission_return" && m.status === "done" && m.playerId !== null) {
    const cargo = amounts(m.cargoHome as Record<string, number>);
    return [{ playerId: m.playerId, notice: {
      kind: "fleet", url: "/?tab=truppen", tag: `fleet-${m.id}`, title: "Verband zurück",
      body: `Der Verband ist heimgekehrt. Ladung: ${cargo}.`, facts: [["Ladung", cargo]],
    } }];
  }
  if ((ev.type === "mission_arrive" || ev.type === "raid_arrive") && m.reportId) return reportNotices(tx, m.reportId);
  return [];
}

const SPY_KIND: Record<string, string> = { erkunden: "Erkunden", sabotage: "Sabotage", desinformation: "Desinformation", kartell: "Kartell-Aufklärung" };

/** Heimkehr eines Spionageauftrags: eigene Meldung „Spione zurück“ mit Art und Ergebnis (aus dem Bericht). */
async function spyReturnNotice(tx: Tx, m: { id: number; playerId: number | null; plan: unknown; reportId: number | null }): Promise<NoticeJob[]> {
  const spy = (m.plan as { spy?: { kind?: string } } | null)?.spy;
  const kind = SPY_KIND[spy?.kind ?? ""] ?? "Spionage";
  let result = "Auftrag ausgeführt";
  let target = "";
  if (m.reportId !== null) {
    const [r] = await tx.select({ winner: tables.battleReport.winner, report: tables.battleReport.report }).from(tables.battleReport).where(eq(tables.battleReport.id, m.reportId));
    const info = (r?.report as { spy?: { aborted?: string; targetName?: string } } | undefined)?.spy;
    target = info?.targetName ?? "";
    result = info?.aborted ? "abgebrochen" : r?.winner === "attacker" ? "gelungen" : result;
  }
  const facts: [string, string][] = [["Auftrag", kind], ...(target ? [["Ziel", target] as [string, string]] : []), ["Ergebnis", result]];
  return [{ playerId: m.playerId!, notice: {
    kind: "fleet", url: "/?tab=meldungen", tag: `spy-back-${m.id}`, title: "Spione zurück",
    body: `${kind}${target ? ` gegen ${target}` : ""}: ${result}. Die Spione sind wieder im Hafen.`, facts,
  } }];
}

/**
 * Plant die Radar-Vorwarnung für einen Angriff auf einen Spielerhafen:
 * fällig zu max(jetzt, Ankunft − Vorwarnzeit). Bei gleicher Fälligkeit läuft die Ankunft zuerst
 * (kleinere ID); die Warnung entfällt dann von selbst.
 */
export async function scheduleAttackWarning(
  tx: Tx,
  input: {
    missionId: number; targetBaseId: number; targetState: BaseState; arriveAtMs: number; nowMs: number;
    /** Modifikatoren des Ziels (Radar) und Tarnfaktor des Angreifers (Mission.warningFactor). */
    targetMods?: Modifiers; warningFactor?: number;
  },
): Promise<number> {
  // Radar mit Strom zum Zeitpunkt der Planung (v1.6): Zustand zuvor fortschreiben.
  const target = settle(input.targetState, input.nowMs, balance, input.targetMods);
  const warnMs = radarWarningMinutes(target, balance, input.targetMods) * (input.warningFactor ?? 1) * 60000;
  const due = Math.max(input.nowMs, input.arriveAtMs - warnMs);
  await scheduleEvent(tx, "attack_warning", due, { missionId: input.missionId }, input.targetBaseId);
  return due;
}

/** Spätestens so oft prüft eine aufgeschobene Warnung das Radar erneut (Strom oder Nebel können sich bessern). */
export const RADAR_RECHECK_MS = 15 * 60000;

/**
 * Ereignis attack_warning: Angriff erkannt, solange der Verband noch unterwegs ist. Geprüft wird mit dem Radar zum
 * Fälligkeitszeitpunkt (Strom, Sabotage, Nebel); ist er noch nicht erfasst, wird neu geplant. Erkannt wird im Plan
 * gemerkt (radar.ts) – Anzeige und Push fallen danach nicht mehr zurück.
 */
export const attackWarning: Handler = async (tx, ev, due) => {
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, Number(ev.payload.missionId)));
  if (!m || m.status !== "outbound" || m.targetKind !== "base" || m.targetId === null) return { notify: [] };
  const b = await readBase(tx, m.targetId);
  if (!b) return { notify: [] };
  if (detectedAtOf(m.plan) === null) {
    const mods = await modsOf(tx, b, due);
    const warn = radarWarningMinutes(settle(b.state, due, balance, mods), balance, mods);
    if (!isDetected(m, due, warn)) {
      const next = Math.min(m.arriveAt.getTime() - warn * warnFactor(m.plan) * 60000, due + RADAR_RECHECK_MS);
      if (next < m.arriveAt.getTime()) await scheduleEvent(tx, "attack_warning", Math.max(next, due + 1), { missionId: m.id }, b.id);
      return { notify: [] };
    }
    await markDetected(tx, [m.id], due);
  }
  let attacker = "Freibeuter-Kartell";
  if (m.playerId !== null) {
    const [p] = await tx.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, m.playerId));
    attacker = p?.name ?? "Unbekannt";
  }
  const arrive = m.arriveAt.getTime();
  const left = minutesText(arrive - due);
  return {
    notify: [[[b.playerId], "missions"]],
    push: [{ playerId: b.playerId, notice: {
      kind: "attack", url: "/?tab=basis", tag: `attack-${m.id}`, title: "Angriff erkannt",
      body: `${attacker} greift ${b.name} an. Ankunft in ${left} (${clock(arrive)} Uhr).`,
      facts: [["Angreifer", attacker], ["Ziel", b.name], ["Ankunft in", left], ["Ankunft", `${clock(arrive)} Uhr`]],
    } }],
  };
};
