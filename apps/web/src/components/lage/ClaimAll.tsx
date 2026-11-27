// Knopf „Alle abholen“ (TST-09) für Basis → Lage („Wartet auf dich“) und die Aufträge: holt Auftragsbuch,
// Tagesbefehle, Wochenziele und Erfolge in einem Zug ab (lib/claim-all.ts) und meldet, was kam und was verfiel.
import { useState } from "react";
import { claimAll } from "../../lib/claim-all.ts";
import { fmtNum, label } from "../../lib/names.ts";
import { errorText, failText } from "../../lib/names.ts";
import { lostNote } from "../RewardClaim.tsx";
import { Button } from "../../ui.tsx";

export function ClaimAllButton({ count, className = "" }: { count: number; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (count < 2 && !note) return null; // eine einzelne Belohnung holt der Spieler an ihrem Ort ab
  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await claimAll();
      if (!r.ok) { setNote(r.code === "nothing" ? "Nichts mehr abzuholen." : r.code === "storage_full" ? errorText("storage_full") : "Abholen ging nicht."); return; }
      const got = Object.entries(r.rewards).filter(([k]) => k !== "points").map(([k, v]) => `${fmtNum(Math.round(v))} ${label(k)}`);
      setNote(`${r.claimed.total} ${r.claimed.total === 1 ? "Belohnung" : "Belohnungen"} abgeholt${got.length ? `: ${got.join(", ")}` : ""}.${lostNote(r.lost)}${(r.skipped?.total ?? 0) > 0 ? ` ${r.skipped!.total} ${r.skipped!.total === 1 ? "bleibt" : "bleiben"} liegen – das Lager ist zu voll.` : ""}`);
    } catch (e) {
      setNote(failText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={className}>
      {count >= 2 && <Button className="w-full" disabled={busy} onClick={() => void run()}>{busy ? "Wird abgeholt …" : `Alle abholen (${count})`}</Button>}
      {note && <p className="text-xs text-moos mt-1.5" role="status" data-testid="claim-all-note">{note}</p>}
    </div>
  );
}
