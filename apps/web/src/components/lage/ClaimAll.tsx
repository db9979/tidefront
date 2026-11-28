// Knopf „Alle abholen“ (TST-09) für Basis → Lage: steht seit UX 0.43 (A1) in der Kopfzeile von „Wartet auf dich“.
// Holt Auftragsbuch, Tagesbefehle, Wochenziele und Erfolge in einem Zug ab (lib/claim-all.ts) und meldet die Summe
// („+1.250 Stahl · +300 Treibstoff“, kurz aufsteigend, L-4; prefers-reduced-motion respektiert). Ein Abholen quittiert
// zugleich die Rückkehrkarte (onClaimed, Entscheidung E-3: verschwindet nach Abholen/Schließen).
import { useState } from "react";
import { claimAll } from "../../lib/claim-all.ts";
import { fmtNum, label } from "../../lib/names.ts";
import { errorText, failText } from "../../lib/names.ts";
import { lostNote } from "../RewardClaim.tsx";

export function useClaimAll(onClaimed?: () => void) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean; seq: number } | null>(null);
  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await claimAll();
      if (!r.ok) { setNote({ ok: false, seq: Date.now(), text: r.code === "nothing" ? "Nichts mehr abzuholen." : r.code === "storage_full" ? errorText("storage_full") : "Abholen ging nicht." }); return; }
      const got = Object.entries(r.rewards).filter(([k]) => k !== "points").map(([k, v]) => `+${fmtNum(Math.round(v))} ${label(k)}`);
      const n = r.claimed.total;
      setNote({ ok: true, seq: Date.now(), text: `${n} ${n === 1 ? "Belohnung" : "Belohnungen"} abgeholt${got.length ? `: ${got.join(" · ")}` : ""}.${lostNote(r.lost)}${(r.skipped?.total ?? 0) > 0 ? ` ${r.skipped!.total} ${r.skipped!.total === 1 ? "bleibt" : "bleiben"} liegen – das Lager ist zu voll.` : ""}` });
      onClaimed?.();
    } catch (e) {
      setNote({ ok: false, seq: Date.now(), text: failText(e) });
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, note };
}

/** Kompakter Knopf für die Gruppenkopfzeile; ab einer abholbereiten Belohnung. */
export function ClaimAllHead({ count, busy, onRun }: { count: number; busy: boolean; onRun: () => void }) {
  if (count < 1) return null;
  return (
    <button type="button" data-testid="claim-all" disabled={busy} onClick={onRun}
      className="tap shrink-0 rounded-lg bg-moos text-white font-display uppercase tracking-[0.08em] text-[12px] px-3 py-1.5 whitespace-nowrap disabled:opacity-60">
      {busy ? "Wird abgeholt …" : `Alle abholen (${count})`}
    </button>
  );
}

/** Rückmeldung mit Summe (unter der Kopfzeile). */
export function ClaimAllNote({ note }: { note: { text: string; ok: boolean; seq: number } | null }) {
  if (!note) return null;
  return <p key={note.seq} className={`tf-claim text-sm font-semibold mb-1 ${note.ok ? "text-moos" : "text-siegel"}`} role="status" data-testid="claim-all-note">{note.text}</p>;
}

/** Bisheriger Vollbreit-Knopf (andere Orte, z. B. Aufträge): ab zwei Belohnungen. */
export function ClaimAllButton({ count, className = "" }: { count: number; className?: string }) {
  const c = useClaimAll();
  if (count < 2 && !c.note) return null;
  return (
    <div className={className}>
      {count >= 2 && (
        <button type="button" disabled={c.busy} onClick={() => void c.run()} className="tap w-full rounded-lg bg-moos text-white font-display uppercase tracking-[0.08em] text-sm py-2.5 disabled:opacity-60">
          {c.busy ? "Wird abgeholt …" : `Alle abholen (${count})`}
        </button>
      )}
      <ClaimAllNote note={c.note} />
    </div>
  );
}
