// Ausführliche E-Mail zu einem Bericht: lädt den Bericht aus Sicht des Lesers (dieselben Daten wie im Spiel,
// views.reportGet) und setzt die angemeldeten Abschnitte zusammen. Für unbekannte Berichtsarten (z. B. neue Arten
// anderer Ausbaustufen) entsteht ein Standard aus Banner und den Zahlen des Berichts.
import { eq } from "drizzle-orm";
import { tables } from "@tidefront/db";
import type { BaseState } from "@tidefront/game-core";
import type { Engine } from "./context.ts";
import type { MailBlock } from "./mail-blocks.ts";
import {
  dateTime, isCounts, isResource, kindLabel, reportSections, resourceRows, unitRows,
  type ReportCtx, type ReportView,
} from "./mail-report-kit.ts";
import "./mail-report-battle.ts";
import "./mail-report-intel.ts";
import "./mail-report-misc.ts";
import { nameOf } from "./names.ts";
import { veteranView } from "./veterans.ts";
import { reportGet } from "./views.ts";

export { registerReportSection, type ReportSection, type ReportView } from "./mail-report-kit.ts";

export interface ReportMailParts {
  subject: string;
  heading: string;
  lead: string;
  blocks: MailBlock[];
}

const SKIP_KEYS = /(^id$|Id$|^seed$|Ms$|^at$)/;

/** Standard für unbekannte Teile: Zahlenlisten als Tabellen, einfache Werte als Kennzahlen (eine Ebene tief). */
export function genericBlocks(data: Record<string, unknown>, depth = 0): MailBlock[] {
  const blocks: MailBlock[] = [];
  const facts: [string, string][] = [];
  for (const [k, v] of Object.entries(data)) {
    if (SKIP_KEYS.test(k) || v === null || v === undefined) continue;
    if (typeof v === "string" && v.length <= 200) facts.push([nameOf(k), v]);
    else if (typeof v === "number" && Number.isFinite(v)) facts.push([nameOf(k), v.toLocaleString("de-DE", { maximumFractionDigits: 2 })]);
    else if (typeof v === "boolean") facts.push([nameOf(k), v ? "ja" : "nein"]);
    else if (isCounts(v)) {
      const keys = Object.keys(v);
      if (!keys.some((x) => v[x] > 0)) continue;
      const res = keys.every(isResource);
      blocks.push({ type: "section", title: nameOf(k) }, { type: "table", head: res ? ["Ressource", "Menge"] : ["Einheit", "Anzahl"], rows: res ? resourceRows(v) : unitRows(v) });
    } else if (depth === 0 && typeof v === "object" && !Array.isArray(v)) {
      blocks.push(...genericBlocks(v as Record<string, unknown>, 1));
    }
  }
  return [...(facts.length ? [{ type: "facts", facts } as MailBlock] : []), ...blocks];
}

/** Bericht → Betreff, Überschrift, Kurzsatz und Bausteine. Reine Funktion (testbar ohne Datenbank). */
export function reportMailParts(r: ReportView, ctx: ReportCtx = { veterans: {} }): ReportMailParts {
  const outs = reportSections().filter((s) => s.applies(r)).map((s) => s.render(r, ctx)).filter((o) => o !== null);
  const blocks = outs.flatMap((o) => o.blocks);
  if (outs.length === 0) blocks.push(...genericBlocks(r.data));
  const bi = blocks.findIndex((b) => b.type === "banner");
  if (bi > 0) blocks.unshift(...blocks.splice(bi, 1));
  else if (bi < 0) blocks.unshift({ type: "banner", tone: r.winner === null ? "info" : (r.winner === "attacker") === (r.role === "attacker") ? "win" : "loss", kicker: kindLabel(r.kind), title: r.title, sub: dateTime(r.atMs) });
  const lead = outs.find((o) => o.lead)?.lead;
  // Kurzsatz direkt unter dem Banner, sofern der Abschnitt dort keinen eigenen Text setzt.
  if (lead && blocks[1]?.type !== "text") blocks.splice(1, 0, { type: "text", text: lead });
  if (blocks.length === 1) blocks.push({ type: "text", text: "Der Bericht liegt im Spiel vor.", tone: "muted" });
  const subject = outs.find((o) => o.subject)?.subject ?? r.title;
  return { subject, heading: r.title, lead: lead ?? `${kindLabel(r.kind)} vom ${dateTime(r.atMs)}.`, blocks };
}

/** Veteranenränge der eigenen Einheiten im beteiligten Hafen (wie unter Truppen); nur bei Kämpfen. */
async function readerCtx(engine: Engine, playerId: number, reportId: number, r: ReportView): Promise<ReportCtx> {
  if (!r.data.battle) return { veterans: {} };
  const [row] = await engine.db
    .select({ a: tables.battleReport.attackerBaseId, d: tables.battleReport.defenderBaseId })
    .from(tables.battleReport)
    .where(eq(tables.battleReport.id, reportId));
  const baseId = r.role === "defender" ? row?.d : row?.a;
  if (!baseId) return { veterans: {} };
  const [b] = await engine.db.select({ playerId: tables.base.playerId, state: tables.base.state }).from(tables.base).where(eq(tables.base.id, baseId));
  if (!b || b.playerId !== playerId) return { veterans: {} };
  const veterans: Record<string, string> = {};
  for (const v of veteranView(b.state as BaseState)) if (v.rank !== "rekrut") veterans[v.id] = v.rankName;
  return { veterans };
}

/** Bericht für einen Spieler laden und aufbereiten; null, wenn er ihn nicht sehen darf oder es ihn nicht gibt. */
export async function reportMailFor(engine: Engine, playerId: number, reportId: number): Promise<(ReportMailParts & { reportId: number }) | null> {
  const r = await reportGet(engine, playerId, reportId);
  if (!r) return null;
  const view: ReportView = { id: r.id, kind: r.kind, title: r.title, atMs: r.atMs, role: r.role as ReportView["role"], winner: r.winner, data: r.data ?? {} };
  const ctx = await readerCtx(engine, playerId, reportId, view).catch(() => ({ veterans: {} }));
  return { ...reportMailParts(view, ctx), reportId: r.id };
}

