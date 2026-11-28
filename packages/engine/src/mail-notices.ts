// E-Mails zu Benachrichtigungen ohne eigenen Bericht: Angriffswarnung mit empfohlenen Schritten, allgemeine
// Meldungen (Kennzahlen als Kacheln) und gebündelte Meldungen (Tabelle mit Zeit). Inhalte nur aus dem, was der
// Spieler im Spiel auch sieht.
import {
  bunkerProtection, fleetSize, protectionStatus, settle, visibleUnitCount,
  type BaseState, type Counts, type Modifiers,
} from "@tidefront/game-core";
import { balance, type Notice } from "./context.ts";
import type { MailBlock } from "./mail-blocks.ts";
import { dateTime, int, nOf, sum, unitRows } from "./mail-report-kit.ts";
import { clock, minutesText } from "./names.ts";

const SIZE_TEXT: Record<string, string> = { klein: "klein", mittel: "mittel", gross: "groß" };
const PROTECTION_TEXT: Record<string, string> = {
  anfaengerschutz: "Anfängerschutz", gruendungsschutz: "Gründungsschutz", niederlage: "Schutz nach Niederlage", nachtschild: "Nachtschild",
};

/**
 * Inhalt der Angriffswarnung (Notice.mail): Ankunft, Angreifer, Größenklasse (wie das Radar sie zeigt), Lage im Hafen
 * und empfohlene Schritte. Kartellverbände zeigt das Spiel genau, Spielerverbände nur als Größenklasse.
 */
export function attackWarningMail(input: {
  attacker: string; targetName: string; arriveAtMs: number; nowMs: number; units: Counts; kartell: boolean;
  state: BaseState; mods?: Modifiers;
}): NonNullable<Notice["mail"]> {
  const s = settle(input.state, input.nowMs, balance, input.mods);
  const left = minutesText(input.arriveAtMs - input.nowMs);
  const ib = balance.intel;
  const size = ib ? SIZE_TEXT[fleetSize(visibleUnitCount(input.units, balance.units), ib)] : null;
  const shield = protectionStatus(s.protection, input.arriveAtMs, balance);
  const home = sum(s.units);
  const away = sum(s.unitsAway);
  const defs = sum(s.defenses);
  const prot = bunkerProtection(s, balance, input.mods);
  const exposed = Object.fromEntries(Object.entries(s.resources).map(([k, v]) => [k, Math.max(0, Math.floor(v) - prot)]));
  const steps: string[] = [];
  if (shield.protected) {
    steps.push(`Dein ${PROTECTION_TEXT[shield.reason ?? ""] ?? "Schutz"} gilt bei Ankunft – der Verband dreht voraussichtlich ohne Kampf ab.`);
  } else {
    steps.push(home > 0
      ? `Truppen daheim lassen: ${nOf(home, "Einheit", "Einheiten")} und ${nOf(defs, "Anlage", "Anlagen")} verteidigen ${input.targetName}.`
      : `Keine Einheiten daheim – nur ${nOf(defs, "Anlage", "Anlagen")} ${defs === 1 ? "verteidigt" : "verteidigen"}. Verbände zurückrufen oder neue ausbilden.`);
    if (away > 0) steps.push(`${away === 1 ? "1 Einheit ist" : `${int(away)} Einheiten sind`} unterwegs – zurückrufen, wenn sie vor ${clock(input.arriveAtMs)} Uhr heimkommen.`);
    if (sum(exposed) > 0) steps.push(`Vorräte über dem Bunkerschutz (${int(prot)} je Ressource) ausgeben oder verschicken – nur sie können geplündert werden.`);
    steps.push("Verbündete um Stationierung im Hafen bitten (Allianz).");
    if (s.protection.nightShieldStartHour === null) steps.push(`Nachtschild einrichten – wirkt erst nach ${balance.protection.nightShieldChangeHours} Stunden Vorlauf, also für künftige Nächte.`);
  }
  const blocks: MailBlock[] = [
    { type: "banner", tone: "warn", kicker: "Radar-Warnung", title: `Ankunft in ${left}`, sub: `${input.attacker} greift ${input.targetName} an · ${clock(input.arriveAtMs)} Uhr` },
    { type: "tiles", tiles: [
      { label: "Ankunft", value: clock(input.arriveAtMs), tone: "warn" },
      { label: "Größe", value: size ?? "unbekannt" },
      { label: "Schutz", value: shield.protected ? "aktiv" : "keiner", tone: shield.protected ? "win" : "loss" },
    ] },
    { type: "section", title: "Umstände" },
    { type: "facts", facts: [
      ["Angreifer", input.attacker],
      ["Ziel", input.targetName],
      ["Ankunft", dateTime(input.arriveAtMs)],
      ["Größenklasse (Radar)", size ?? "unbekannt"],
      ["Einheiten daheim", int(home)],
      ["Anlagen", int(defs)],
      ["Bunkerschutz", `${int(prot)} je Ressource`],
    ] },
  ];
  if (input.kartell && sum(input.units) > 0) {
    blocks.push({ type: "section", title: "Kartellverband" }, { type: "table", head: ["Einheit", "Anzahl"], rows: unitRows(input.units) });
  }
  blocks.push({ type: "section", title: "Empfohlene Schritte" }, { type: "list", items: steps });
  return { subject: `⚠︎ Angriff auf ${input.targetName} in ${left}`, lead: `${input.attacker} greift ${input.targetName} an. Ankunft um ${clock(input.arriveAtMs)} Uhr.`, blocks };
}

/** Standardinhalt einer Meldung: Kennzahlen als Kacheln (bis drei kurze), sonst als Liste. */
export function defaultNoticeBlocks(n: Notice): MailBlock[] {
  const facts = n.facts ?? [];
  if (!facts.length) return [];
  const short = facts.length <= 3 && facts.every(([, v]) => v.length <= 14);
  return short ? [{ type: "tiles", tiles: facts.map(([label, value]) => ({ label, value })) }] : [{ type: "facts", facts }];
}

const KIND_TEXT: Record<string, string> = {
  attack: "Angriff", report: "Bericht", build: "Ausbau", training: "Ausbildung", fleet: "Verband", delivery: "Lieferung", ops: "Betrieb", market: "Börse", test: "Test",
  daily: "Tagesbefehle", idle: "Bauschlange", nest: "Nest", comeback: "Rückkehr",
};

/** Gebündelte Meldungen als Tabelle (Zeit | Art | Meldung), neueste zuletzt; Länge begrenzt die Tabelle selbst. */
export function digestBlocks(rows: { kind: string; title: string; body: string; createdAt: Date }[]): MailBlock[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  return [
    { type: "tiles", tiles: [...counts].slice(0, 3).map(([k, n]) => ({ label: KIND_TEXT[k] ?? k, value: String(n) })) },
    { type: "table", head: ["Zeit", "Meldung"], align: ["left", "left"], rows: rows.map((r) => [{ v: clock(r.createdAt.getTime()), muted: true }, `${r.title}: ${r.body}`]) },
  ];
}

/** Kurzer Betreffteil der Bündelung: die häufigsten Titel, z. B. „Ausbau fertig (3), Lieferung angekommen“. */
export function digestSubject(rows: { title: string }[]): string {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.title, (n.get(r.title) ?? 0) + 1);
  const top = [...n].sort((a, b) => b[1] - a[1]);
  const shown = top.slice(0, 2).map(([t, k]) => (k > 1 ? `${t} (${k})` : t));
  return top.length > 2 ? `${shown.join(", ")} u. a.` : shown.join(", ");
}
