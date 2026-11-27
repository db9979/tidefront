// Weitere Berichtsteile in der E-Mail: Lieferung, See (Minen, Blockade, Konvoi), verlassenes Nest, abgewiesener
// Kartellverband, Weltereignis und Sammelangriff/stationierte Verteidiger der Allianz.
import type { Cell, MailBlock } from "./mail-blocks.ts";
import {
  counts, dateTime, int, num, registerReportSection, resText, resourceRows, str, sum, unitTable,
  type Counts, type ReportView,
} from "./mail-report-kit.ts";
import { nameOf } from "./names.ts";

function renderTransport(r: ReportView) {
  const cargo = counts(r.data.cargo);
  const from = str(r.data.from, "?");
  const to = str(r.data.to, "?");
  const incoming = r.role === "recipient";
  const rows = resourceRows(cargo, incoming ? "+" : "");
  return {
    subject: incoming ? `Lieferung von ${from}: ${resText(cargo, "leer", 3)}` : `Transport an ${to} zugestellt: ${resText(cargo, "leer", 3)}`,
    lead: incoming ? `${from} hat deinem Hafen ${to} ${resText(cargo)} geliefert.` : `Von ${from} an ${to}: ${resText(cargo)}.`,
    blocks: [
      { type: "banner", tone: "win", kicker: incoming ? "Lieferung erhalten" : "Transport", title: incoming ? `Von ${from}` : `An ${to}`, sub: dateTime(r.atMs) } as MailBlock,
      { type: "section", title: "Ladung" } as MailBlock,
      rows.length
        ? ({ type: "table", head: ["Ressource", "Menge"], rows: rows.map((x) => [x[0], { v: x[1] as string, tone: incoming ? "win" : undefined }] as Cell[]), foot: rows.length > 1 ? ["Gesamt", int(sum(cargo))] : undefined } as MailBlock)
        : ({ type: "text", text: "Keine Ladung.", tone: "muted" } as MailBlock),
    ],
  };
}

function renderMines(r: ReportView) {
  const m = r.data.mines as { action?: string; leg?: string; strength?: number; swept?: { owner: string; before: number; after: number }[]; hits?: { owner: string; strength: number; losses: Counts; share?: number }[]; before?: Counts; after?: Counts; refused?: string; lost?: Counts; cargoLeft?: Counts };
  const blocks: MailBlock[] = [];
  if (m.action === "legen") blocks.push({ type: "text", text: m.refused ? "Nicht gelegt: Höchstzahl an Feldern erreicht." : `Das Feld hat jetzt Stärke ${int(m.strength ?? 0)}. Fremde Schiffe, die hindurchfahren, sinken.` });
  if (m.action === "raeumen") {
    blocks.push(m.swept?.length
      ? { type: "table", head: ["Minenfeld von", "vorher", "nachher"], rows: m.swept.map((s) => [s.owner, int(s.before), int(s.after)]) }
      : { type: "text", text: "Keine Minen gefunden." });
  }
  if (m.action === "konvoi" || m.action === "durchfahrt") {
    if (m.hits?.length) {
      blocks.push({ type: "table", head: ["Minenfeld von", "Stärke", m.action === "konvoi" ? "Ladung" : "Verluste"], rows: m.hits.map((h) => [h.owner, int(h.strength), m.action === "konvoi" ? { v: `−${Math.round((h.share ?? 0) * 1000) / 10} %`, tone: "loss" } : { v: `−${int(sum(h.losses))}`, tone: "loss" }]) });
    }
    if (m.action === "konvoi") blocks.push({ type: "facts", facts: [["Versenkt", resText(counts(m.lost))], ["Ladung danach", resText(counts(m.cargoLeft))]] });
    else blocks.push(...unitTable("Verband danach", counts(m.after)));
  }
  return { blocks };
}

function renderBlockade(r: ReportView) {
  const b = r.data.blockade as { targetName?: string; attackerName?: string; endsAtMs?: number; refused?: string; factor?: number };
  const text = b.refused
    ? `Die Blockade vor ${str(b.targetName, "?")} begann nicht (${b.refused === "fleet_lost" ? "Verband verloren" : nameOf(b.refused)}).`
    : `${str(b.attackerName, "?")} blockiert ${str(b.targetName, "?")} bis ${dateTime(b.endsAtMs ?? 0)}: Produktion −${Math.round((1 - (b.factor ?? 1)) * 100)} %, Lieferungen zurückgehalten, Börsenverkäufe gesperrt.`;
  return { lead: text, blocks: [{ type: "text", text } as MailBlock] };
}

function renderConvoy(r: ReportView) {
  const c = r.data.convoy as { by?: string; held?: boolean | null; lost?: Counts; loot?: Counts; cargoLeft?: Counts; missed?: boolean; force?: Counts };
  if (c.missed) return { blocks: [{ type: "text", text: "Der Konvoi war schon eingelaufen." } as MailBlock] };
  const held = c.held === true ? "Der Geleitschutz hat gehalten – nichts verloren." : c.held === false ? "Der Geleitschutz unterlag." : "Ohne Geleitschutz.";
  const blocks: MailBlock[] = [{ type: "text", text: held }];
  if (c.by === "kartell" && c.force) blocks.push(...unitTable("Kartellverband", counts(c.force)));
  const facts: [string, string][] = [];
  if (c.held !== true) facts.push(["Verlust", resText(counts(c.lost))]);
  if (c.loot && sum(counts(c.loot)) > 0) facts.push(["Davon erbeutet", resText(counts(c.loot))]);
  facts.push(["Ladung danach", resText(counts(c.cargoLeft))]);
  blocks.push({ type: "facts", facts });
  return { lead: held, blocks };
}

function renderWorldEvent(r: ReportView) {
  if (r.kind === "weltereignis_leer") {
    const t = str(r.data.text, "Bei Ankunft war niemand mehr da.");
    return { lead: t, blocks: [{ type: "text", text: `${t} Der Verband kehrt um.` } as MailBlock] };
  }
  const we = r.data.worldEvent as { destroyed?: boolean; destroyedHp?: number; initialHp?: number; remaining?: Counts };
  const blocks: MailBlock[] = [{ type: "section", title: "Weltereignis" }];
  blocks.push({ type: "text", text: we.destroyed ? "Der Kartellverband ist vernichtet." : sum(counts(we.remaining)) > 0 ? `Verbleibend: ${resText(counts(we.remaining), "–", 6)}.` : "Der Kartellverband ist noch da." });
  const hp = num(we.destroyedHp);
  if (hp !== null) blocks.push({ type: "facts", facts: [["Dein Schaden", `${int(hp)} Lebenspunkte${we.initialHp ? ` (${Math.round((hp / we.initialHp) * 100)} % der Anfangsstärke)` : ""}`]] });
  return { blocks };
}

interface Part { name: string; share: number; outcome: { losses: Counts }; loot: Counts }
function renderAlliance(r: ReportView) {
  const raid = r.data.allianceRaid as { tag: string; participants: Part[] } | undefined;
  const guests = Array.isArray(r.data.guests) ? (r.data.guests as { name: string; losses: Counts }[]) : [];
  const blocks: MailBlock[] = [];
  if (raid?.participants?.length) {
    blocks.push(
      { type: "section", title: `Sammelangriff [${raid.tag}]` },
      { type: "table", head: ["Teilnehmer", "Beitrag", "Verluste", "Beute"], rows: raid.participants.map((p) => [p.name, `${(p.share ?? 0).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`, int(sum(p.outcome?.losses)), int(sum(p.loot))]) },
    );
  }
  if (guests.length) blocks.push({ type: "section", title: "Stationierte Verteidiger" }, { type: "table", head: ["Verbündeter", "Verluste"], rows: guests.map((g) => [g.name, int(sum(g.losses))]) });
  return blocks.length ? { blocks } : null;
}

registerReportSection({ id: "transport", applies: (r) => r.kind === "transport", render: renderTransport });
registerReportSection({ id: "mines", applies: (r) => !!r.data.mines, render: renderMines });
registerReportSection({ id: "blockade", applies: (r) => !!r.data.blockade, render: renderBlockade });
registerReportSection({ id: "convoy", applies: (r) => !!r.data.convoy, render: renderConvoy });
registerReportSection({ id: "worldEvent", applies: (r) => r.kind.startsWith("weltereignis") && (!!r.data.worldEvent || r.kind === "weltereignis_leer"), render: renderWorldEvent });
registerReportSection({ id: "alliance", applies: (r) => !!r.data.allianceRaid || Array.isArray(r.data.guests), render: renderAlliance });
registerReportSection({ id: "leer", applies: (r) => r.kind === "leer", render: () => ({ subject: undefined, blocks: [{ type: "text", text: "Das Nest war bei Ankunft verlassen. Der Verband kehrt um." }] }) });
registerReportSection({
  id: "abgewiesen",
  applies: (r) => r.kind === "abgewiesen",
  render: (r) => ({ blocks: [{ type: "text", text: `Ein Verband des Kartells erreichte deinen Hafen, traf aber auf deinen Schutz (${nameOf(str(r.data.reason, "nachtschild"))}) und drehte ohne Kampf ab.` }] }),
});
