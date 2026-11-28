// Weltpolitik Stufe 2: eigener globaler Ruf unter Meldungen → Saison → Welt (docs/REGELN-WELTPOLITIK.md, Abschnitt 3a):
// Wert und Stufe (Berüchtigt · Unbescholten · Angesehen) auf einer Leiste, was die Stufe bewirkt, laufende Ächtung,
// Verlauf der letzten 10 Buchungen (Zerfall als eigene Zeile). Fremder Ruf erscheint nur als Zeichen in der Rangliste.
import { useState } from "react";
import { fmtAt, fmtDuration, useCountdownNow } from "../../lib/time.ts";
import { Badge } from "../../ui.tsx";
import type { PolitikOverview } from "./use-politik.ts";

type Ruf = NonNullable<PolitikOverview["ruf"]>;

export const RUF_TEXT: Record<string, string> = { beruechtigt: "Berüchtigt", unbescholten: "Unbescholten", angesehen: "Angesehen" };
const REASON: Record<string, string> = {
  vertrag: "KI-Liefervertrag erfüllt", gesuch: "Gesuch erfüllt", handel: "Gebühren im Handel", hilfe: "Kartell im fremden Hafen abgewehrt",
  kartell: "Konvoi/Feld gegen das Kartell gehalten", schwachziel: "Überfall auf ein Schwachziel", strafe: "Vertragsstrafe", paktbruch: "Paktbruch",
  blockade: "Blockade eines Spielerhafens", zerfall: "Zerfall (5 % je Tag)",
};
const fmt1 = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",").replace("-", "−");

export function RufCard({ ruf }: { ruf: Ruf }) {
  const [open, setOpen] = useState(false);
  const now = useCountdownNow(ruf.aechtungUntilMs);
  const share = (ruf.value + 100) / 200;
  const r = ruf.rules;
  const effect = ruf.level === "angesehen"
    ? "Alle KI-Spieler behandeln dich wie „Vertraut“: Vertragsbonus +2 Punkte, mehr Kontingent, Pakt möglich."
    : ruf.level === "beruechtigt"
      ? `Händler und Festung schließen nichts mit dir ab und geben keine Gesuche; wer dich angreift, bekommt +${Math.round(r.notoriousBounty * 100)} % Kopfgeld. Der Seerat kann dich ächten.`
      : `Ab +${r.angesehenFrom} bist du angesehen, ab ${fmt1(r.beruechtigtTo)} berüchtigt.`;
  return (
    <div className="mt-2 rounded-lg border border-rule p-2.5" data-testid="ruf-card" aria-label="Dein Ruf">
      <div className="flex items-center gap-2 flex-wrap">
        <strong className="font-serif text-[16px]">Dein Ruf</strong>
        <Badge tone={ruf.level === "beruechtigt" ? "red" : ruf.level === "angesehen" ? "green" : "slate"}>{RUF_TEXT[ruf.level]}</Badge>
        <span className="mono" data-testid="ruf-value">{fmt1(ruf.value)}</span>
      </div>
      <div className="relative h-1.5 bg-inset border border-rule mt-1" role="meter" aria-label="Ruf" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(ruf.value)}>
        <div className="absolute inset-y-0 left-[35%] right-[35%] bg-rule/40" aria-hidden="true" />
        <div className={`absolute top-0 bottom-0 w-1 ${ruf.level === "beruechtigt" ? "bg-siegel" : ruf.level === "angesehen" ? "bg-moos" : "bg-ink"}`} style={{ left: `calc(${share * 100}% - 2px)` }} />
      </div>
      <p className="text-xs text-ink2 mt-1">{effect}</p>
      {ruf.aechtungUntilMs !== null && ruf.aechtungUntilMs > now && (
        <p className="text-xs text-siegel mt-1" data-testid="ruf-aechtung">Geächtet vom Seerat: noch {fmtDuration(ruf.aechtungUntilMs - now)} keine KI-Verträge und Gesuche, Kopfgeld +{Math.round(r.aechtungBounty * 100)} %.</p>
      )}
      <p className="text-[11px] text-ink2 mt-1">Ruf öffnet Türen bei den KI-Spielern – er zählt nicht im Rang und ändert keine Börsenpreise. Er verliert jeden Tag {Math.round(r.decayPerDay * 100)} % in Richtung 0.</p>
      {ruf.history.length > 0 && (
        <button type="button" className="tap text-xs text-ink2 underline mt-0.5" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Verlauf schließen" : "Verlauf"}</button>
      )}
      {open && (
        <ul className="mt-1 text-xs" data-testid="ruf-verlauf">
          {ruf.history.map((h, i) => (
            <li key={`${h.atMs}-${i}`} className="flex gap-2 py-0.5 border-b border-dotted border-rule last:border-b-0">
              <span className="mono text-ink2 shrink-0">{fmtAt(h.atMs, now)}</span>
              <span className="flex-1 min-w-0">{REASON[h.reason] ?? h.reason}</span>
              <span className={`mono shrink-0 ${h.delta < 0 ? "text-siegel" : "text-moos"}`}>{h.delta > 0 ? "+" : ""}{fmt1(h.delta)}</span>
              <span className="mono shrink-0 w-10 text-right">{fmt1(h.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Rangliste: Zeichen nur für die äußeren Stufen (kein Pranger mit Zahlen); beim eigenen Eintrag mit Wert. */
export function RufMark({ ruf }: { ruf: { level: string | null; value: number | null } | null | undefined }) {
  if (!ruf?.level) return null;
  const bad = ruf.level === "beruechtigt";
  return (
    <span title={bad ? "Berüchtigt (Ruf −30 oder tiefer): Händler und Festung schließen nichts ab, Kopfgeld für Angreifer" : "Angesehen (Ruf +30 oder höher)"}
      data-testid="ruf-mark"
      className={`ml-1 align-[1px] rounded border px-1 text-[11px] font-semibold whitespace-nowrap ${bad ? "border-siegel text-siegel" : "border-moos text-moos"}`}>
      {bad ? "⚑ Berüchtigt" : "✦ Angesehen"}{ruf.value !== null ? ` ${fmt1(ruf.value)}` : ""}
    </span>
  );
}
