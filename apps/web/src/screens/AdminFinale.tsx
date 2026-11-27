// Verwaltung → Saisonfinale vorziehen (Testsystem): kündigt die Kartell-Armada jetzt an und lässt sie nach der gewählten
// Zeit erscheinen; Dauer wie geplant (anteilig zur Saisonlänge, höchstens bis kurz vor Saisonende).
import { useState } from "react";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { Button, Card, ErrorLine } from "../ui.tsx";

const CHOICES = [0, 15, 60, 12 * 60];

export function AdminFinale() {
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await trpcClient.admin.startFinale.mutate({ appearInMinutes: minutes });
      if (!r.ok) setError(errorText(r.code));
      else setDone(`Angekündigt. Die Armada erscheint ${fmtTime(r.appearAtMs)} und zieht ${fmtTime(r.endsAtMs)} ab.`);
      await queryClient.invalidateQueries(trpc.worldEvents.list.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Saisonfinale vorziehen" collapsible storageKey="admin-finale" defaultOpen={false} summary="Kartell-Armada jetzt ankündigen (Testsystem)">
      <p className="text-xs text-ink2 mb-3">
        Kündigt das Saisonfinale „Leviathan“ sofort an, statt an Tag 36. Die Stärke wird beim Erscheinen aus den aktiven Häfen
        festgelegt. Ein schon beendetes Finale dieser Saison wird ersetzt (Ergebnis gelöscht); ein laufendes bleibt.
      </p>
      <label className="text-sm flex items-center gap-2 mb-3">
        Erscheinen in
        <select className="rounded-lg bg-navy-950 border border-navy-600 px-2 py-2 text-sm" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Erscheinen in">
          {CHOICES.map((m) => <option key={m} value={m}>{m === 0 ? "sofort" : m < 60 ? `${m} Minuten` : `${m / 60} Stunden`}</option>)}
        </select>
      </label>
      <Button disabled={busy} onClick={() => void start()}>Finale jetzt ankündigen</Button>
      {done && <p className="text-sm text-moos mt-2" role="status">{done}</p>}
      {error && <ErrorLine text={error} />}
    </Card>
  );
}
