// Lagebild Stufe 3 in der E-Mail: Satellitenstart (Kosten, Bahn, erster Überflug) und Ende der Lebensdauer
// (Zusammenfassung aller Überflüge). Dieselben Daten wie der Bericht im Spiel (report.satellite).
import type { MailBlock } from "./mail-blocks.ts";
import { counts, dateTime, int, num, registerReportSection, resourceRows, str, type ReportView } from "./mail-report-kit.ts";

interface SatData {
  event?: "start" | "end";
  name?: string;
  baseName?: string;
  cost?: Record<string, number>;
  expiresAtMs?: number;
  passes?: number;
  plannedPasses?: number;
  periodHours?: number;
  stripKm?: number;
  liveMinutes?: number;
  level?: string;
  cloudMax?: number | null;
  firstPass?: { atMs: number; where: string } | null;
  seen?: number;
  clouded?: number;
  last?: { atMs: number; seen: number; nests: number; bases: number; fleets: number; where?: string } | null;
}

function renderSatellite(r: ReportView) {
  const s = r.data.satellite as SatData;
  const name = str(s.name, "Satellit");
  if (s.event === "end") {
    const blocks: MailBlock[] = [
      { type: "banner", tone: "info", kicker: "Raumfahrt", title: `${name} verglüht`, sub: `${str(s.baseName)} · ${dateTime(r.atMs)}` },
      { type: "tiles", tiles: [
        { label: "Überflüge", value: `${int(num(s.passes) ?? 0)} / ${int(num(s.plannedPasses) ?? 0)}` },
        { label: "Sichtungen", value: int(num(s.seen) ?? 0) },
        { label: "unter Wolken", value: int(num(s.clouded) ?? 0) },
      ] },
      { type: "text", text: "Das gespeicherte Wissen bleibt wie jede Sichtung bis zu 72 Stunden erhalten. Ein neuer Satellit startet an der Startrampe (Meldungen → Lagebild)." },
    ];
    if (s.last) blocks.push({ type: "text", tone: "muted", text: `Letzter Überflug ${dateTime(s.last.atMs)}${s.last.where ? ` über ${s.last.where}` : ""}: ${int(s.last.nests)} Nester, ${int(s.last.bases)} Häfen, ${int(s.last.fleets)} Verbände.` });
    return { subject: `${name} verglüht – ${int(num(s.passes) ?? 0)} Überflüge, ${int(num(s.seen) ?? 0)} Sichtungen`, lead: `${name} hat seine Lebensdauer erreicht.`, blocks };
  }
  const blocks: MailBlock[] = [
    { type: "banner", tone: "win", kicker: "Raumfahrt", title: `${name} gestartet`, sub: `${str(s.baseName)} · ${dateTime(r.atMs)}` },
    { type: "facts", facts: [
      ["Bahn", `alle ${int(num(s.periodHours) ?? 6)} h ein Überflug, Streifen ${int(num(s.stripKm) ?? 600)} km, je ${int(num(s.liveMinutes) ?? 20)} min live`],
      ["Kenntnis", s.level === "sichtung" ? "Sichtung, durch Wolken und Nebel" : `Erkennung, nicht unter Wolken (Bewölkung über ${Math.round((num(s.cloudMax) ?? 0.6) * 100)} %)`],
      ["Überflüge", int(num(s.passes) ?? 0)],
      ["Lebensdauer bis", s.expiresAtMs ? dateTime(s.expiresAtMs) : "?"],
      ...(s.firstPass ? [["Erster Überflug", `${dateTime(s.firstPass.atMs)} über ${s.firstPass.where}`] as [string, string]] : []),
    ] },
  ];
  const cost = resourceRows(counts(s.cost));
  if (cost.length) blocks.push({ type: "section", title: "Startkosten" }, { type: "table", head: ["Ressource", "Menge"], rows: cost });
  return { subject: `${name} gestartet${s.firstPass ? ` – erster Überflug über ${s.firstPass.where}` : ""}`, lead: `${name} ist in der Umlaufbahn.`, blocks };
}

registerReportSection({ id: "satellite", applies: (r) => r.kind === "satellit" && !!r.data.satellite, render: renderSatellite });
