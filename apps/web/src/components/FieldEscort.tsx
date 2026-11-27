// Felder: Geleitabteilung einer Besatzung festlegen (begleitet die Ertragskonvois, verteidigt das Feld nur gegen das Kartell),
// Hinweise zu Vorwarnung und Verstärkung. Teil von „Meine Felder“ (Fields.tsx). Regeln: docs/REGELN-FELDER.md.
import { useState } from "react";
import { trpc, trpcClient } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { label } from "../lib/names.ts";
import { fmtDuration, fmtTime, useNow } from "../lib/time.ts";
import { Button, ErrorLine, Stepper, UnitChips } from "../ui.tsx";

type Counts = Record<string, number>;

const invalidate = () => [trpc.fields.pathFilter().queryKey, trpc.base.pathFilter().queryKey];

/** Geleitzeile mit Bearbeiten: Schiffe der Besatzung auswählen, Rest muss eine gültige Besatzung bleiben. */
export function FieldEscortEditor({ fieldId, garrison, escort }: { fieldId: number; garrison: Counts; escort: Counts }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Counts>(escort);
  const save = useCommand((i: { key: string; fieldId: number; units: Counts }) => trpcClient.fields.escort.mutate(i), invalidate);
  const has = Object.values(escort).some((n) => n > 0);
  if (!open) {
    return (
      <div className="text-xs flex items-center gap-2 flex-wrap">
        <span>Geleit für Ertragskonvois:</span> {has ? <UnitChips counts={escort} /> : <span className="text-ink2">keines</span>}
        <button type="button" className="tap text-sea-300 underline" onClick={() => { setPick(escort); setOpen(true); }}>{has ? "ändern" : "einteilen"}</button>
      </div>
    );
  }
  const ids = Object.keys(garrison).filter((id) => (garrison[id] ?? 0) > 0);
  return (
    <div className="text-xs mt-1 rounded border border-navy-700 p-2 space-y-1">
      <p className="text-ink2">Diese Schiffe begleiten die Ertragskonvois und kämpfen gegen Kartell und Kriegsgegner; fahren mehrere Konvois zugleich, teilen sie sich nach Warenwert auf. Gegen angekündigte Kartellangriffe verteidigen sie auch das Feld, gegen Spieler nicht – der Rest muss eine gültige Besatzung bleiben.</p>
      {ids.map((id) => (
        <div key={id} className="flex items-center justify-between gap-2">
          <span>{label(id)} <span className="text-ink2">(Besatzung {garrison[id]})</span></span>
          <Stepper compact value={pick[id] ?? 0} max={garrison[id]} onChange={(v) => setPick({ ...pick, [id]: v })} />
        </div>
      ))}
      <div className="flex gap-2">
        <Button className="flex-1" disabled={save.busy} onClick={() => void save.run({ fieldId, units: pick }).then((r) => { if (r?.ok) setOpen(false); })}>Geleit übernehmen</Button>
        <Button kind="secondary" disabled={save.busy} onClick={() => setOpen(false)}>Abbrechen</Button>
      </div>
      <ErrorLine text={save.error} />
    </div>
  );
}

/** Erkannte Angriffe (Radar des Heimathafens) und eigene Verstärkungen unterwegs. */
export function FieldIncomingLines({ incoming, reinforcements }: { incoming: { arriveAtMs: number }[]; reinforcements: { arriveAtMs: number; units: Counts }[] }) {
  const now = useNow();
  return (
    <>
      {incoming.map((a, i) => (
        <div key={`a${i}`} className="text-xs font-semibold text-siegel">Angriff erkannt – Ankunft in {fmtDuration(Math.max(0, a.arriveAtMs - now))} ({fmtTime(a.arriveAtMs)})</div>
      ))}
      {reinforcements.map((r, i) => (
        <div key={`r${i}`} className="text-xs text-moos">Verstärkung unterwegs, Ankunft in {fmtDuration(Math.max(0, r.arriveAtMs - now))}: <UnitChips counts={r.units} /></div>
      ))}
    </>
  );
}
