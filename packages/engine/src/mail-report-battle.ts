// Kampfbericht in der E-Mail: Ergebnis-Banner, Kurzfazit, Kennzahlen, Verbände beider Seiten (Start → Verlust →
// übrig), Beute, Wetter und Admirale. Gilt für jede Berichtsart mit Kampfdaten (Überfall, Kartell, Nest, Feld,
// Weltereignis, See, Sammelangriff …) – auch für künftige Arten, solange sie `battle` mitliefern.
import type { Cell, MailBlock } from "./mail-blocks.ts";
import {
  counts, dateTime, int, kindLabel, num, pct, registerReportSection, resText, resourceRows, str, sum, unitCell,
  type Counts, type ReportCtx, type ReportView,
} from "./mail-report-kit.ts";
import { nameOf } from "./names.ts";
import { beaufort } from "@tidefront/game-core";

/** Faktor mit zwei Nachkommastellen und Dezimalkomma, z. B. „0,85“. */
const dec1 = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
const dec2 = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Outcome { before?: Counts; losses?: Counts; returned?: Counts; final?: Counts; survivors?: Counts }
interface Battle {
  winner?: string;
  airSuperiority?: string | null;
  landed?: boolean;
  attacker?: Outcome;
  defender?: Outcome;
  loot?: Counts;
  wreck?: Counts;
  weather?: { air: number; strike: number; wind: number; clouds: number; storm: boolean };
  phases?: { phase: string; skipped: boolean }[];
}
interface AdmiralSide { hidden?: boolean; name?: string; rankName?: string; xpGain?: number; xp?: number; promoted?: string | null; lossShare?: number; roll?: number | null; fate?: string; until?: number | null }

const FATE: Record<string, string> = { unversehrt: "unversehrt", verwundet: "verwundet", gefangen: "in Gefangenschaft geraten", gefallen: "gefallen" };

const side = (o: Outcome | undefined) => {
  const before = counts(o?.before);
  const final = o?.final ? counts(o.final) : null;
  const losses = o?.losses ? counts(o.losses) : null;
  // Endgültiger Verlust: Start − übrig (Rückkehrer aus Lazarett/Reparatur zählen nicht als verloren).
  const lost = (id: string) => (final ? Math.max(0, (before[id] ?? 0) - (final[id] ?? 0)) : losses?.[id] ?? 0);
  const left = (id: string) => final?.[id] ?? Math.max(0, (before[id] ?? 0) - lost(id));
  return { before, lost, left, returned: counts(o?.returned) };
};

/** Tabelle eines Verbands: Einheit | Start | Verlust | übrig, mit Summenzeile. */
function forceTable(title: string, o: Outcome | undefined, vets: Record<string, string>): MailBlock[] {
  const s = side(o);
  const ids = Object.keys(s.before).filter((id) => (s.before[id] ?? 0) > 0).sort((a, b) => s.before[b] - s.before[a]);
  if (!ids.length) return [{ type: "section", title }, { type: "text", text: "Keine Einheiten im Kampf.", tone: "muted" }];
  const rows: Cell[][] = ids.map((id) => {
    const lost = s.lost(id);
    return [unitCell(id, vets[id]), int(s.before[id]), lost > 0 ? { v: `−${int(lost)}`, tone: "loss" } : { v: "±0", muted: true }, int(s.left(id))];
  });
  const totalLost = ids.reduce((n, id) => n + s.lost(id), 0);
  const totalLeft = ids.reduce((n, id) => n + s.left(id), 0);
  const back = sum(s.returned);
  return [
    { type: "section", title },
    {
      type: "table", head: ["Einheit", "Start", "Verlust", "Übrig"], rows,
      foot: ids.length > 1 ? ["Gesamt", int(sum(s.before)), totalLost > 0 ? { v: `−${int(totalLost)}`, tone: "loss" } : "±0", int(totalLeft)] : undefined,
      caption: back > 0 ? `Zurück aus Lazarett/Reparatur (in „Übrig“ enthalten): ${resText(s.returned, "–", 6)}` : undefined,
    },
  ];
}

const weatherText = (w: Battle["weather"]) =>
  !w ? null : `${w.storm ? "Sturm" : `Wind ${beaufort(w.wind)} Bft`}, Wolken ${Math.round(w.clouds * 100)} %${w.air < 0.995 || w.strike < 0.995 ? ` – Flugzeuge ×${dec2(w.air)}, Luftschlag ×${dec2(w.air * w.strike)}` : " – ohne Einfluss"}`;

function admiralLines(who: string, a: AdmiralSide | undefined): string[] {
  if (!a) return [];
  const parts = [`${who}: ${str(a.rankName)} ${str(a.name)}`.trim()];
  if (a.hidden) return [parts[0]]; // gegnerischer Admiral im Spielerkampf: nur Rang und Name
  parts.push((a.xpGain ?? 0) > 0 ? `Erfahrung +${int(a.xpGain!)} (jetzt ${int(a.xp ?? 0)})` : "keine Erfahrung");
  if (a.promoted) parts.push(`befördert zum ${a.promoted}`);
  if (a.roll !== null && a.roll !== undefined) parts.push(`Schicksal: ${FATE[a.fate ?? ""] ?? str(a.fate, "?")}${a.until ? ` bis ${dateTime(a.until)}` : ""}`);
  else parts.push(FATE[a.fate ?? ""] ?? "unversehrt");
  return [parts.join(" · ")];
}

/** Eigene Sicht: Sieg/Niederlage, Verlustanteil, Beute bzw. Plünderung. */
export function battleSummary(r: ReportView) {
  const b = r.data.battle as Battle;
  const mine: "attacker" | "defender" = r.role === "defender" ? "defender" : "attacker";
  const theirs = mine === "attacker" ? "defender" : "attacker";
  const won = (b.winner === "attacker") === (mine === "attacker");
  const own = side(b[mine]);
  const foe = side(b[theirs]);
  const ownBefore = sum(own.before);
  const ownLost = Object.keys(own.before).reduce((n, id) => n + own.lost(id), 0);
  const foeBefore = sum(foe.before);
  const foeLost = Object.keys(foe.before).reduce((n, id) => n + foe.lost(id), 0);
  return { b, mine, won, ownBefore, ownLost, foeBefore, foeLost, loot: counts(b.loot) };
}

function renderBattle(r: ReportView, ctx: ReportCtx) {
  const d = r.data;
  const { b, mine, won, ownBefore, ownLost, foeBefore, foeLost, loot } = battleSummary(r);
  const names = [str(d.attackerName, "Angreifer"), str(d.defenderName, "Verteidiger")];
  const target = str(d.targetName, r.title);
  const lootSum = sum(loot);
  const gain = mine === "attacker";
  const lossShare = pct(ownLost, ownBefore);
  const fazit = gain
    ? won ? `Gewonnen mit ${lossShare} Verlust${lootSum > 0 ? `, Beute ${resText(loot)}` : ""}.` : `Verloren – ${lossShare} der eigenen Einheiten sind gefallen.`
    : won ? `${names[0]} abgewehrt, eigene Verluste ${lossShare}.` : `${target} verloren – ${lootSum > 0 ? `${resText(loot)} geplündert` : "nichts geplündert"}, eigene Verluste ${lossShare}.`;
  // v1.35: Kartell-Überfall – bleibender Verlust (Plünderung + Einheiten) in Stunden Produktion des Hafens.
  const lossHours = r.kind === "kartell" ? num(d.lossHours) : null;
  const lossText = lossHours !== null && lossHours > 0 ? ` Bleibender Verlust (Plünderung und Einheiten) etwa ${dec1(lossHours)} h Produktion.` : "";
  const subject = gain
    ? won ? `Sieg bei ${target}${lootSum > 0 ? ` – Beute ${resText(loot, "", 2)}` : ""}` : `Niederlage bei ${target} – ${lossShare} Verlust`
    : won ? `${target} gehalten – ${names[0]} abgewehrt` : `${target} überwunden${lootSum > 0 ? ` – ${resText(loot, "", 2)} geplündert` : ""}`;

  const blocks: MailBlock[] = [
    { type: "banner", tone: won ? "win" : "loss", kicker: `Kampfbericht · ${kindLabel(r.kind)}`, title: won ? (gain ? "Sieg" : "Abgewehrt") : gain ? "Niederlage" : "Verloren", sub: `${names[0]} gegen ${names[1]} · ${target} · ${dateTime(r.atMs)}` },
    { type: "text", text: fazit + lossText },
    {
      type: "tiles", tiles: [
        { label: "Verluste", value: `${lossShare}`, tone: ownLost > 0 ? "loss" : "win" },
        { label: "Gegner", value: pct(foeLost, foeBefore), tone: foeLost > 0 ? "win" : undefined },
        { label: gain ? "Beute" : "Geplündert", value: lootSum > 0 ? `${gain ? "+" : "−"}${int(lootSum)}` : "0", tone: lootSum > 0 ? (gain ? "win" : "loss") : undefined },
      ],
    },
  ];
  const vets = (who: "attacker" | "defender") => (who === mine ? ctx.veterans : {});
  blocks.push(...forceTable(`Verband ${names[0]}${mine === "attacker" ? " (du)" : ""}`, b.attacker, vets("attacker")));
  blocks.push(...forceTable(`${mine === "defender" ? "Verteidigung" : "Gegner"} ${names[1]}${mine === "defender" ? " (du)" : ""}`, b.defender, vets("defender")));

  blocks.push({ type: "section", title: gain ? "Beute" : "Plünderung" });
  const lootRows = resourceRows(loot, gain ? "+" : "−").map((row) => [row[0], { v: row[1] as string, tone: gain ? "win" : "loss" }] as Cell[]);
  if (lootRows.length) blocks.push({ type: "table", head: ["Ressource", "Menge"], rows: lootRows, foot: lootRows.length > 1 ? ["Gesamt", `${gain ? "+" : "−"}${int(lootSum)}`] : undefined });
  else blocks.push({ type: "text", text: gain ? "Keine Beute." : "Nichts geplündert.", tone: "muted" });
  const facts: [string, string][] = [];
  const salvage = counts(d.salvage);
  if (gain && sum(salvage) > 0) facts.push(["Zusätzlich geborgen (Wrackgut)", resText(salvage)]);
  if (lossHours !== null) facts.push(["Bleibender Verlust", `${dec1(lossHours)} h Produktion (Plünderung und Einheiten)`]);
  const prot = num(d.protectedPerResource);
  if (prot !== null) facts.push([`Bunkerschutz ${names[1]}`, `${int(prot)} je Ressource`]);
  facts.push(["Neues Wrackfeld am Kampfort", resText(counts(b.wreck), "keins")]);

  facts.push(["Luftüberlegenheit", b.airSuperiority === "attacker" ? names[0] : b.airSuperiority === "defender" ? names[1] : "keine"]);
  facts.push(["Landung", b.landed ? "ja" : "nein"]);
  const w = weatherText(b.weather);
  if (w) facts.push(["Wetter", w]);
  const phases = (b.phases ?? []).filter((p) => !p.skipped).map((p) => nameOf(p.phase));
  if (phases.length) facts.push(["Phasen", phases.join(" → ")]);
  blocks.push({ type: "section", title: "Lage" }, { type: "facts", facts });

  const adm = d.admirals as { attacker?: AdmiralSide; defender?: AdmiralSide } | undefined;
  const admLines = adm ? [...admiralLines(names[0], adm.attacker), ...admiralLines(names[1], adm.defender)] : [];
  if (admLines.length) blocks.push({ type: "section", title: "Admirale" }, { type: "list", items: admLines });
  return { blocks, subject, lead: fazit };
}

registerReportSection({ id: "battle", applies: (r) => !!r.data.battle && r.kind !== "spionage", render: renderBattle });
