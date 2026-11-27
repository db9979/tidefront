// Nachrichtendienst in der Oberfläche: Sabotage-Hinweis im Hafen, Info-Blatt-Teil des Nachrichtendiensts und
// Spionage-/Sabotageberichte. Alle Werte kommen vom Server (base.intel, Berichtsdaten).
import type { BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtTime } from "../lib/time.ts";
import { Icon } from "../icons.tsx";
import { Card, CountsLine, StatTable } from "../ui.tsx";
import { partsText, spyKindText } from "./SpyPlan.tsx";

type Counts = Record<string, number>;

const SABOTAGE_EFFECT: Record<string, string> = {
  kraftwerk: "Gebäudeproduktion halbiert",
  radarstation: "keine Vorwarnung vor Angriffen",
  werft: "Bau steht still, neue Aufträge dauern doppelt so lang",
  kaserne: "Ausbildung steht still, neue Aufträge dauern doppelt so lang",
  flugfeld: "Ausbildung steht still, neue Aufträge dauern doppelt so lang",
  forschungsamt: "Forschung steht still, neue dauert doppelt so lang",
  seekabel: "Seekabel unterbrochen",
  bauschlange: "Ausbau verzögert",
};

/** Hinweis auf eine laufende Sabotage im eigenen Hafen. */
export function SabotageBanner({ base, now }: { base: BaseData; now: number }) {
  const s = base.intel?.sabotage;
  if (!s || s.untilMs <= now) return null;
  return (
    <div className="rounded-xl bg-red-950 border border-siegel border-l-4 p-3 mb-3 flex gap-3 items-center" role="status">
      <Icon id="sabotage" size={40} />
      <div className="text-sm">
        <strong className="text-siegel uppercase font-display text-xs">Sabotage: {label(s.target)}</strong>
        <div className="font-serif leading-tight">{s.target === "bauschlange" ? "Bauschlange verzögert" : `sabotiert bis ${fmtTime(s.untilMs)}`} · noch <span className="mono">{fmtDuration(s.untilMs - now)}</span></div>
        <div className="text-xs text-ink2">{SABOTAGE_EFFECT[s.target] ?? ""}. Der Täter ist unbekannt – ein stärkerer Nachrichtendienst und Verschlüsselung erschweren es.</div>
      </div>
    </div>
  );
}

/** Kleine Marke für Gebäudekacheln. */
export function sabotagedUntil(base: BaseData, id: string, now: number): number | null {
  const s = base.intel?.sabotage;
  return s && s.target === id && s.untilMs > now ? s.untilMs : null;
}

/** Teil des Info-Blatts „Nachrichtendienst“. */
export function IntelPanel({ base, now }: { base: BaseData; now: number }) {
  const i = base.intel;
  if (!i) return null;
  // Kurze Werte, damit die Beschriftung auf Handybreite nicht in eine schmale Spalte gedrückt wird.
  const rows: [string, string][] = [
    ["Spione daheim", fmtNum(i.spies.home)],
    ["Spione unterwegs", fmtNum(i.spies.away)],
    ...(i.spies.training > 0 ? [["Spione in Ausbildung", fmtNum(i.spies.training)] as [string, string]] : []),
    ["Höchstzahl Spione", fmtNum(i.cap)],
    ["Abwehr gegen fremde Spione", String(i.defense.total)],
    ["Erfolgswert Erkunden", String(i.success.erkunden?.total ?? 0)],
    ["Erfolgswert Sabotage", String(i.success.sabotage?.total ?? 0)],
    ["Gelungene Aufträge (Erfahrung)", fmtNum(i.successes)],
  ];
  if (i.disinfo.count > 0 && i.disinfo.untilMs) rows.push(["Desinformation ausgelegt", `${i.disinfo.count} · bis ${fmtTime(i.disinfo.untilMs)}`]);
  if (i.sabotageCooldownUntilMs > now) rows.push(["Alarmbereitschaft nach Sabotage", `bis ${fmtTime(i.sabotageCooldownUntilMs)}`]);
  return (
    <div className="mb-3">
      <StatTable rows={rows} />
      <p className="text-xs text-ink2 mt-1">Abwehr: {partsText(i.defense)}</p>
    </div>
  );
}

interface SpyData {
  kind: string; building: string | null; spies: number; targetName: string; owner: string; from: string;
  roll?: number; die?: number; threshold?: number; success?: boolean; aborted?: string;
  successValue?: { total: number; parts: { id: string; value: number }[] };
  defenseValue?: { total: number; parts: { id: string; value: number }[] };
}

/** Würfel und Werte eines Spionageberichts (für beide Seiten). */
function Dice({ s }: { s: SpyData }) {
  if (s.roll === undefined) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-paper border border-rule p-2 mb-2">
      <div className={`w-12 h-12 grid place-items-center rounded-lg border-2 font-display text-xl ${s.success ? "border-moos text-moos" : "border-siegel text-siegel"}`}>{s.roll}</div>
      <div className="text-sm">
        <div>Wurf W{s.die}: <strong>{s.roll}</strong> {s.success ? "≤" : ">"} Zielzahl {s.threshold} – <strong className={s.success ? "text-moos" : "text-siegel"}>{s.success ? "gelungen, unentdeckt" : "misslungen, enttarnt"}</strong></div>
        {s.successValue && <div className="text-xs text-slate-400">Erfolgswert {s.successValue.total} ({partsText(s.successValue)})</div>}
        {s.defenseValue && <div className="text-xs text-slate-400">Abwehr {s.defenseValue.total} ({partsText(s.defenseValue)})</div>}
      </div>
    </div>
  );
}

/** Spionagebericht (kind „spionage“). role: attacker = eigener Auftrag, defender = fremder Spion enttarnt. */
export function SpyReport({ d, role }: { d: Record<string, unknown>; role: string }) {
  const s = d.spy as SpyData;
  const what = spyKindText(s.kind) + (s.building ? ` (${label(s.building)})` : "");
  return (
    <>
      <Card title={role === "defender" ? "Fremder Spion enttarnt" : `Auftrag: ${what}`}>
        {role === "defender" ? (
          <p className="text-sm mb-2">Absender: <strong>{s.from}</strong>. Auftrag: {what}. {fmtNum(s.spies)} {s.spies === 1 ? "Spion" : "Spione"} ausgeschaltet.</p>
        ) : (
          <p className="text-sm mb-2">Ziel: {s.targetName}{s.owner && s.kind !== "kartell" ? ` (${s.owner})` : ""}. {s.aborted ?? (s.success ? "Der Auftrag ist gelungen; das Ziel hat nichts bemerkt." : `Enttarnt – ${s.spies === 1 ? "der Spion ist" : "die Spione sind"} verloren${s.kind === "kartell" ? "." : ", das Ziel kennt jetzt deinen Namen."}`)}</p>
        )}
        <Dice s={s} />
      </Card>
      {d.dossier ? <Dossier x={d.dossier as DossierData} /> : null}
      {d.sabotage ? <Card title="Sabotage"><p className="text-sm">{String((d.sabotage as { effect: string }).effect)}</p></Card> : null}
      {d.disinfo ? <Card title="Desinformation ausgelegt"><p className="text-sm">Bis {fmtTime((d.disinfo as { untilMs: number }).untilMs)} sieht {s.targetName} im nächsten Lagebild über dich etwa {fmtNum((d.disinfo as { forceFactor: number }).forceFactor, 1)}-mal so viele Truppen und Anlagen und nur einen Bruchteil deiner Vorräte.</p></Card> : null}
      {d.cartel ? <Cartel c={d.cartel as CartelData} /> : null}
    </>
  );
}

/** Sabotage aus Sicht des Opfers (ohne Absender). */
export function SabotageReport({ d }: { d: Record<string, unknown> }) {
  const s = d.sabotage as { target: string; untilMs: number; effect: string };
  return (
    <Card title={`Sabotage: ${label(s.target)}`}>
      <div className="flex gap-3 items-center"><Icon id="sabotage" size={40} /><p className="text-sm">{s.effect} {SABOTAGE_EFFECT[s.target] ? `(${SABOTAGE_EFFECT[s.target]})` : ""} Der Täter ist unbekannt.</p></div>
    </Card>
  );
}

interface DossierData {
  scout: { resources: Counts; units: Counts; defenses: Counts; buildings: Counts; protectedPerResource: number };
  research: { levels: Counts; order: { name: string; targetLevel: number; finishesAt: number } | null } | null;
  buildQueue: { buildingId: string; targetLevel: number; finishesAt: number }[];
  trainingQueue: { id: string; count: number; finishesAt: number }[];
  veterans: { id: string; rankName: string }[];
  missions: { type: string; status: string; target: { col: number; row: number }; units: Counts; arriveAtMs: number; returnAtMs: number | null }[] | null;
}

function Dossier({ x }: { x: DossierData }) {
  const s = x.scout;
  return (
    <Card title="Dossier">
      <div className="text-sm space-y-1">
        <div><span className="text-slate-400">Bestände:</span> <CountsLine counts={s.resources} /></div>
        <div><span className="text-slate-400">Einheiten:</span> <CountsLine counts={s.units} /></div>
        <div><span className="text-slate-400">Anlagen:</span> <CountsLine counts={s.defenses} /></div>
        <div><span className="text-slate-400">Gebäude:</span> {Object.entries(s.buildings).filter(([, l]) => l > 0).map(([id, l]) => `${label(id)} ${l}`).join(", ") || "–"}</div>
        <div><span className="text-slate-400">Forschung:</span> {x.research?.order ? `${x.research.order.name} Stufe ${x.research.order.targetLevel} bis ${fmtTime(x.research.order.finishesAt)}` : "keine laufende"}</div>
        <div><span className="text-slate-400">Bauschlange:</span> {x.buildQueue.map((o) => `${label(o.buildingId)} ${o.targetLevel} (${fmtTime(o.finishesAt)})`).join(", ") || "leer"}</div>
        <div><span className="text-slate-400">Ausbildung:</span> {x.trainingQueue.map((o) => `${fmtNum(o.count)} × ${label(o.id)} (${fmtTime(o.finishesAt)})`).join(", ") || "keine"}</div>
        <div><span className="text-slate-400">Veteranen:</span> {x.veterans.map((v) => `${label(v.id)}: ${v.rankName}`).join(", ") || "keine"}</div>
        {x.missions && (
          <div><span className="text-slate-400">Missionen:</span> {x.missions.length === 0 ? "keine" : (
            <ul className="list-disc ml-4">
              {x.missions.map((m, k) => <li key={k}>{label(m.type)} → Feld {m.target.col}/{m.target.row}, {m.status === "outbound" ? `Ankunft ${fmtTime(m.arriveAtMs)}` : `Rückkehr ${m.returnAtMs ? fmtTime(m.returnAtMs) : "?"}`} · <CountsLine counts={m.units} /></li>)}
            </ul>
          )}</div>
        )}
      </div>
    </Card>
  );
}

interface CartelData {
  next: { atMs: number; kind: string | null } | null;
  events: { id: number; name: string; status: string; position: { col: number; row: number }; endsAtMs: number; units: Counts; harbor: { col: number; row: number } | null; route: { col: number; row: number; atMs: number }[]; targets: { name: string; atMs: number | null }[]; siege: { baseName: string } | null }[];
}

function Cartel({ c }: { c: CartelData }) {
  return (
    <Card title="Aus dem Kartell">
      <div className="text-sm space-y-2">
        <p>{c.next ? `Nächstes Unternehmen: ${c.next.kind ? label(c.next.kind) : "unbekannt"} um ${fmtTime(c.next.atMs)}.` : "Kein weiteres Unternehmen geplant."}</p>
        {c.events.length === 0 && <p className="text-slate-400">Derzeit kein Weltereignis.</p>}
        {c.events.map((e) => (
          <div key={e.id} className="rounded-lg bg-paper border border-rule p-2 break-words">
            <strong>{e.name}</strong> · Feld {e.position.col}/{e.position.row} · endet {fmtTime(e.endsAtMs)}
            <div className="text-xs"><CountsLine counts={e.units} /></div>
            {e.harbor && <div className="text-xs">Zielhafen: Feld {e.harbor.col}/{e.harbor.row}</div>}
            {e.route.length > 0 && <div className="text-xs">Kurs: {e.route.map((p) => `${p.col}/${p.row} ${fmtTime(p.atMs)}`).join(" → ")}</div>}
            {e.targets.length > 0 && <div className="text-xs">Ziele: {e.targets.map((t) => `${t.name}${t.atMs ? ` (${fmtTime(t.atMs)})` : ""}`).join(", ")}</div>}
            {e.siege && <div className="text-xs">Belagert: {e.siege.baseName}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}
