// Weltpolitik: Ansehen bei einem KI-Spieler (docs/REGELN-WELTPOLITIK.md, Abschnitt 3) auf seiner Karte unter
// Börse → Verträge: Stufe und Wert, Wirkung auf Vertragsbonus und Kontingent, Sperre mit Grund, Verlauf der letzten
// Buchungen (Zerfall als eigene Zeile).
import { useState } from "react";
import { fmtAt, fmtDuration, useCountdownNow } from "../../lib/time.ts";
import { Badge } from "../../ui.tsx";
import { LEVEL_TEXT, LEVEL_TONE, pp, REASON_TEXT, usePolitikKi } from "./use-politik.ts";

const fmt1 = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");

export function KiAnsehen({ kiId, name }: { kiId: number; name: string }) {
  const q = usePolitikKi();
  const [open, setOpen] = useState(false);
  const k = q.data?.kis.find((x) => x.id === kiId);
  const blockEnd = k?.blockedUntilMs ?? null;
  const now = useCountdownNow(blockEnd);
  if (!k) return null;
  const share = (k.value + 100) / 200;
  return (
    <div className="mt-1.5 rounded-md border border-rule p-2 text-xs" data-testid="ki-ansehen" aria-label={`Ansehen bei ${name}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-display uppercase text-[11px] text-ink2">Ansehen</span>
        <Badge tone={LEVEL_TONE[k.level] ?? "slate"}>{LEVEL_TEXT[k.level] ?? k.level}</Badge>
        <span className="mono">{fmt1(k.value)}</span>
        <span className="text-ink2">Bonus {pp(k.bonusDelta)} · Kontingent {k.quotaShare !== null ? `${Math.round(k.quotaShare * 100)} %` : "–"}</span>
      </div>
      <div className="relative h-1.5 bg-inset border border-rule mt-1" role="meter" aria-label="Ansehen" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(k.value)}>
        <div className="absolute inset-y-0 left-[35%] right-[35%] bg-rule/40" aria-hidden="true" />
        <div className={`absolute top-0 bottom-0 w-1 ${k.level === "misstraut" ? "bg-siegel" : k.level === "vertraut" ? "bg-moos" : "bg-ink"}`} style={{ left: `calc(${share * 100}% - 2px)` }} />
      </div>
      {k.refuses && (
        <p className="text-siegel mt-1">
          {k.reason === "ueberfall" && blockEnd !== null && blockEnd > now
            ? `Nach deinem Überfall schließt ${name} noch ${fmtDuration(blockEnd - now)} nichts mit dir ab.`
            : k.reason === "beruechtigt" ? `Du bist berüchtigt – ${name} schließt nichts mit dir ab und gibt keine Gesuche.` : `${name} schließt gerade nichts mit dir ab.`}
        </p>
      )}
      {!k.refuses && k.pakt && <p className="text-moos mt-1">Vertraut: {name} schließt einen Nichtangriffspakt mit dir.</p>}
      {k.history.length > 0 && (
        <button type="button" className="tap text-ink2 underline mt-0.5" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Verlauf schließen" : "Verlauf"}</button>
      )}
      {open && (
        <ul className="mt-1" data-testid="ki-ansehen-verlauf">
          {k.history.map((h, i) => (
            <li key={`${h.atMs}-${i}`} className="flex gap-2 py-0.5 border-b border-dotted border-rule last:border-b-0">
              <span className="mono text-ink2 shrink-0">{fmtAt(h.atMs, now)}</span>
              <span className="flex-1 min-w-0">{REASON_TEXT[h.reason] ?? h.reason}</span>
              <span className={`mono shrink-0 ${h.delta < 0 ? "text-siegel" : "text-moos"}`}>{h.delta > 0 ? "+" : ""}{fmt1(h.delta)}</span>
              <span className="mono shrink-0 w-10 text-right">{fmt1(h.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
