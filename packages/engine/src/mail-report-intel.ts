// Aufklärung, Spionage und Felder in der E-Mail: Lagebild des Ziels genau so, wie der Bericht es im Spiel zeigt
// (inklusive Unsicherheit bei Nebel; Desinformation ist für den Leser nicht erkennbar und bleibt es auch hier).
import type { Cell, MailBlock } from "./mail-blocks.ts";
import {
  counts, dateTime, int, nOf, num, registerReportSection, resText, resourceRows, str, sum, unitTable,
  type Counts, type ReportView,
} from "./mail-report-kit.ts";
import { nameOf } from "./names.ts";

interface Scout { resources?: Counts; units?: Counts; defenses?: Counts; buildings?: Counts; protectedPerResource?: number; uncertain?: { fog: number; heavy: boolean } }

/** Lagebild eines Hafens: Kennzahlen, Bestände, Einheiten, Anlagen, Gebäude. */
export function scoutBlocks(s: Scout, opts: { atMs?: number } = {}): MailBlock[] {
  const units = counts(s.units);
  const defs = counts(s.defenses);
  const res = counts(s.resources);
  const blocks: MailBlock[] = [
    { type: "tiles", tiles: [
      { label: "Einheiten", value: int(sum(units)) },
      { label: "Anlagen", value: int(sum(defs)) },
      { label: "Bestände", value: int(sum(res)) },
    ] },
  ];
  if (s.uncertain) {
    blocks.push({ type: "text", tone: "warn", text: `Sichtung unsicher – Nebel am Ziel (${Math.round(s.uncertain.fog * 100)} %): Bestände, Einheiten und Anlagen nur ${s.uncertain.heavy ? "grob " : ""}gerundet, Gebäude genau.` });
  }
  blocks.push({ type: "section", title: "Bestände" });
  const rows = resourceRows(res);
  blocks.push(rows.length ? { type: "table", head: ["Ressource", "Menge"], rows } : { type: "text", text: "Keine Vorräte.", tone: "muted" });
  const prot = num(s.protectedPerResource);
  if (prot !== null) blocks.push({ type: "text", tone: "muted", text: `Bunkerschutz: ${int(prot)} je Ressource – davon ist nichts zu erbeuten.` });
  blocks.push(...unitTable("Einheiten", units), ...unitTable("Anlagen", defs, ["Anlage", "Anzahl"]));
  const b = Object.entries(counts(s.buildings)).filter(([, l]) => l > 0).sort((a, c) => c[1] - a[1]);
  if (b.length) blocks.push({ type: "section", title: "Gebäude" }, { type: "table", head: ["Gebäude", "Stufe"], rows: b.map(([id, l]) => [nameOf(id), String(l)]) });
  if (opts.atMs) blocks.push({ type: "text", tone: "muted", text: `Stand der Sichtung: ${dateTime(opts.atMs)}.` });
  return blocks;
}

function renderScout(r: ReportView) {
  const d = r.data;
  const s = d.scout as Scout;
  const target = str(d.targetName, r.title.replace(/^Aufklärung: /, ""));
  const owner = str(d.owner);
  const units = sum(counts(s.units));
  const defs = sum(counts(s.defenses));
  const lead = `Lagebild von ${target}${owner ? ` (${owner})` : ""}: ${nOf(units, "Einheit", "Einheiten")}, ${nOf(defs, "Anlage", "Anlagen")}, Vorräte ${resText(counts(s.resources), "keine", 2)}`.replace(/\.?$/, ".");
  return {
    subject: `Aufklärung: ${target} – ${nOf(units, "Einheit", "Einheiten")}, ${nOf(defs, "Anlage", "Anlagen")}${s.uncertain ? " (unsicher)" : ""}`,
    lead,
    blocks: [
      { type: "banner", tone: "info", kicker: "Aufklärung", title: target, sub: `${owner ? `${owner} · ` : ""}${dateTime(r.atMs)}` } as MailBlock,
      ...scoutBlocks(s),
    ],
  };
}

function renderNest(r: ReportView) {
  const n = r.data.nest as { level?: number; empty?: boolean; garrison?: { units?: Counts; defenses?: Counts; loot?: Counts } | null };
  const level = num(n.level);
  const title = `Piratennest${level !== null ? ` Stufe ${level}` : ""}`;
  const banner: MailBlock = { type: "banner", tone: "info", kicker: "Aufklärung", title, sub: dateTime(r.atMs) };
  if (n.empty || !n.garrison) return { subject: `Aufklärung: ${title} – verlassen`, lead: "Das Nest ist verlassen.", blocks: [banner, { type: "text", text: "Das Nest ist verlassen." } as MailBlock] };
  const g = n.garrison;
  const loot = counts(g.loot);
  return {
    subject: `Aufklärung: ${title} – ${int(sum(counts(g.units)))} Mann, Beute ${resText(loot, "keine", 1)}`,
    lead: `Besatzung ${nOf(sum(counts(g.units)), "Einheit", "Einheiten")}, ${nOf(sum(counts(g.defenses)), "Anlage", "Anlagen")}, Beute ${resText(loot)}`.replace(/\.?$/, "."),
    blocks: [
      banner,
      { type: "tiles", tiles: [
        { label: "Besatzung", value: int(sum(counts(g.units))) },
        { label: "Anlagen", value: int(sum(counts(g.defenses))) },
        { label: "Beute", value: int(sum(loot)), tone: "win" },
      ] } as MailBlock,
      ...unitTable("Besatzung", counts(g.units)),
      ...unitTable("Anlagen", counts(g.defenses), ["Anlage", "Anzahl"]),
      { type: "section", title: "Mögliche Beute" } as MailBlock,
      { type: "table", head: ["Ressource", "Menge"], rows: resourceRows(loot) } as MailBlock,
    ],
  };
}

const FIELD_KIND: Record<string, string> = { oelfeld: "Ölfeld", erzbucht: "Erzbucht", fischgrund: "Fischgrund", elektronikwrack: "Elektronik-Wrack" };
const OUTCOME_TEXT: Record<string, string> = {
  captured: "Feld besetzt – deine Besatzung hält es, der Rest des Verbands fährt heim.",
  cleared: "Wache bzw. Besatzung geschlagen, aber die Überlebenden reichen nicht für eine Besatzung. Das Feld ist neutral.",
  limit: "Feld freigekämpft, aber die Höchstzahl deiner Felder ist erreicht. Das Feld ist neutral.",
  held: "Der Angriff wurde abgewiesen.",
  cartel: "Das Kartell hat die Besatzung geschlagen. Das Feld ist wieder neutral.",
  reinforced: "Die Verstärkung ist eingetroffen und gehört jetzt zur Besatzung.",
};
const REFUSED: Record<string, string> = {
  own_field: "das Feld gehört dir schon", fleet_lost: "keine Schiffe mehr im Verband", field_lost: "das Feld wird nicht mehr von dir gehalten",
};

function renderField(r: ReportView) {
  const f = r.data.field as { kind?: string; tier?: number; owner?: string | null; units?: Counts; garrison?: Counts; outcome?: string; refused?: string; gone?: boolean };
  if (f.gone) return { blocks: [{ type: "text", text: "Das Feld gibt es nicht mehr (Saisonwechsel oder neu verteilt). Der Verband kehrt um." } as MailBlock] };
  const name = `${FIELD_KIND[f.kind ?? ""] ?? "Rohstofffeld"}${f.tier ? ` (Stufe ${f.tier})` : ""}`;
  const blocks: MailBlock[] = [];
  const scouting = r.kind === "aufklaerung";
  if (scouting) blocks.push({ type: "banner", tone: "info", kicker: "Feld-Aufklärung", title: name, sub: `${f.owner ? `Besatzung von ${f.owner}` : "Kartell-Wache"} · ${dateTime(r.atMs)}` });
  if (f.refused) blocks.push({ type: "text", text: `Nicht besetzt: ${REFUSED[f.refused] ?? "Verbündete und Paktpartner greift man nicht an"}.` });
  if (f.outcome && OUTCOME_TEXT[f.outcome]) blocks.push({ type: "text", text: OUTCOME_TEXT[f.outcome] });
  if (f.outcome === "reinforced" && f.garrison) blocks.push(...unitTable("Besatzung jetzt", counts(f.garrison)));
  const units = f.units ? counts(f.units) : null;
  if (units && !r.data.battle) blocks.push(...unitTable(f.outcome === "reinforced" ? "Verstärkung" : f.owner ? `Besatzung von ${f.owner}` : "Kartell-Wache", units));
  if (scouting && units) {
    const n = sum(units);
    return {
      subject: `Aufklärung: ${name} – ${n ? `${f.owner ? "Besatzung" : "Wache"} ${nOf(n, "Einheit", "Einheiten")}` : "unbewacht"}`,
      lead: `${name}: ${n ? `${f.owner ? `Besatzung von ${f.owner}` : "Kartell-Wache"} mit ${nOf(n, "Einheit", "Einheiten")}` : "keine Wache"}.`,
      blocks,
    };
  }
  return { blocks };
}

interface SpyData { kind?: string; building?: string | null; spies?: number; targetName?: string; owner?: string; from?: string; roll?: number; die?: number; threshold?: number; success?: boolean; aborted?: string }
const SPY_KIND: Record<string, string> = { erkunden: "Erkunden", sabotage: "Sabotage", desinformation: "Desinformation", kartell: "Kartell-Aufklärung" };

function renderSpy(r: ReportView) {
  const d = r.data;
  const s = d.spy as SpyData;
  const what = `${SPY_KIND[s.kind ?? ""] ?? "Spionage"}${s.building ? ` (${nameOf(s.building)})` : ""}`;
  const spies = `${int(s.spies ?? 0)} ${s.spies === 1 ? "Spion" : "Spione"}`;
  const blocks: MailBlock[] = [];
  if (r.role === "defender") {
    blocks.push(
      { type: "banner", tone: "win", kicker: "Spionageabwehr", title: "Fremder Spion enttarnt", sub: `Absender ${str(s.from, "?")} · ${dateTime(r.atMs)}` },
      { type: "facts", facts: [["Absender", str(s.from, "?")], ["Auftrag", what], ["Ausgeschaltet", spies]] },
    );
    return { subject: `Fremder Spion enttarnt – Absender ${str(s.from, "?")}`, lead: `${str(s.from, "?")} wollte ${what}. ${spies} ausgeschaltet.`, blocks };
  }
  const ok = !s.aborted && !!s.success;
  const result = s.aborted ?? (ok ? "Der Auftrag ist gelungen; das Ziel hat nichts bemerkt." : `Enttarnt – ${s.spies === 1 ? "der Spion ist" : "die Spione sind"} verloren${s.kind === "kartell" ? "." : ", das Ziel kennt jetzt deinen Namen."}`);
  blocks.push(
    { type: "banner", tone: s.aborted ? "info" : ok ? "win" : "loss", kicker: `Spionage · ${what}`, title: s.aborted ? "Abgebrochen" : ok ? "Gelungen" : "Enttarnt", sub: `${str(s.targetName, "?")}${s.owner && s.kind !== "kartell" ? ` (${s.owner})` : ""} · ${dateTime(r.atMs)}` },
    { type: "text", text: result },
  );
  if (s.roll !== undefined) blocks.push({ type: "facts", facts: [["Wurf", `W${s.die ?? 20}: ${s.roll} ${ok ? "≤" : ">"} Zielzahl ${s.threshold ?? "?"}`], ["Eingesetzt", spies]] });
  const dossier = d.dossier as { scout?: Scout; research?: { order?: { name: string; targetLevel: number; finishesAt: number } | null } | null; buildQueue?: { buildingId: string; targetLevel: number; finishesAt: number }[]; trainingQueue?: { id: string; count: number; finishesAt: number }[]; veterans?: { id: string; rankName: string }[] } | undefined;
  if (dossier?.scout) {
    blocks.push({ type: "section", title: "Dossier" }, ...scoutBlocks(dossier.scout));
    const queue: Cell[][] = [
      ...(dossier.buildQueue ?? []).map((o) => [`Ausbau ${nameOf(o.buildingId)} ${o.targetLevel}`, dateTime(o.finishesAt)] as Cell[]),
      ...(dossier.trainingQueue ?? []).map((o) => [`${int(o.count)} × ${nameOf(o.id)}`, dateTime(o.finishesAt)] as Cell[]),
      ...(dossier.research?.order ? [[`Forschung ${dossier.research.order.name} ${dossier.research.order.targetLevel}`, dateTime(dossier.research.order.finishesAt)] as Cell[]] : []),
    ];
    if (queue.length) blocks.push({ type: "section", title: "Aufträge des Ziels" }, { type: "table", head: ["Auftrag", "fertig"], rows: queue });
    if (dossier.veterans?.length) blocks.push({ type: "list", items: [`Veteranen: ${dossier.veterans.map((v) => `${nameOf(v.id)}: ${v.rankName}`).join(", ")}`] });
  }
  if (d.sabotage) blocks.push({ type: "section", title: "Sabotage" }, { type: "text", text: str((d.sabotage as { effect?: string }).effect) });
  if (d.disinfo) {
    const x = d.disinfo as { untilMs: number; forceFactor: number };
    blocks.push({ type: "section", title: "Desinformation ausgelegt" }, { type: "text", text: `Bis ${dateTime(x.untilMs)} sieht ${str(s.targetName, "das Ziel")} im nächsten Lagebild über dich etwa ${(x.forceFactor ?? 1).toLocaleString("de-DE", { maximumFractionDigits: 1 })}-mal so viele Truppen und Anlagen und nur einen Bruchteil deiner Vorräte.` });
  }
  const cartel = d.cartel as { next?: { atMs: number; kind: string | null } | null; events?: { name: string; position: { col: number; row: number }; endsAtMs: number; units: Counts }[] } | undefined;
  if (cartel) {
    blocks.push({ type: "section", title: "Aus dem Kartell" }, { type: "text", text: cartel.next ? `Nächstes Unternehmen: ${cartel.next.kind ? nameOf(cartel.next.kind) : "unbekannt"} um ${dateTime(cartel.next.atMs)}.` : "Kein weiteres Unternehmen geplant." });
    if (cartel.events?.length) blocks.push({ type: "table", head: ["Ereignis", "Feld", "Stärke", "endet"], align: ["left", "right", "right", "right"], rows: cartel.events.map((e) => [e.name, `${e.position.col}/${e.position.row}`, int(sum(e.units)), dateTime(e.endsAtMs)]) });
  }
  return { subject: `Spionage: ${what} gegen ${str(s.targetName, "?")} – ${s.aborted ? "abgebrochen" : ok ? "gelungen" : "enttarnt"}`, lead: result, blocks };
}

function renderSabotageVictim(r: ReportView) {
  const s = r.data.sabotage as { target?: string; untilMs?: number; effect?: string };
  return {
    subject: `Sabotage: ${nameOf(str(s.target, "?"))}`,
    lead: str(s.effect),
    blocks: [
      { type: "banner", tone: "loss", kicker: "Sabotage", title: nameOf(str(s.target, "?")), sub: dateTime(r.atMs) } as MailBlock,
      { type: "text", text: `${str(s.effect)} Der Täter ist unbekannt.` } as MailBlock,
      ...(s.untilMs ? [{ type: "facts", facts: [["Wirkt bis", dateTime(s.untilMs)]] } as MailBlock] : []),
    ],
  };
}

registerReportSection({ id: "scout", applies: (r) => !!r.data.scout && r.kind !== "spionage", render: renderScout });
registerReportSection({ id: "nest", applies: (r) => !!r.data.nest, render: renderNest });
registerReportSection({ id: "field", applies: (r) => !!r.data.field, render: renderField });
registerReportSection({ id: "spy", applies: (r) => r.kind === "spionage" && !!r.data.spy, render: renderSpy });
registerReportSection({ id: "sabotage", applies: (r) => r.kind === "sabotage" && !!r.data.sabotage, render: renderSabotageVictim });
