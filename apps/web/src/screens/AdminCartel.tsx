// Verwaltung → Kartell: Regler für die Stärke der Kartell-Überfälle (25–300 % der Balance-Grundstärke).
// Gilt für Überfälle, die ab dem Speichern auslaufen; die Siegquote zeigt Statistik → Kampf.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { failText } from "../lib/names.ts";
import { Button, Card, ErrorLine } from "../ui.tsx";

const MIN = 25;
const MAX = 300;
const STEP = 5;

function hint(pct: number): string {
  if (pct < 75) return "Schwach: Überfälle sind kaum mehr als ein Ärgernis.";
  if (pct <= 110) return "Standard: Das Kartell siegt selten, kostet aber bei jedem Überfall Truppen.";
  if (pct <= 160) return "Stark: Schlecht verteidigte Häfen verlieren öfter.";
  return "Sehr stark: Auch gut verteidigte Häfen geraten regelmäßig in Not.";
}

export function AdminCartel() {
  const q = useQuery(trpc.admin.cartelStrength.queryOptions());
  const [pct, setPct] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = q.data?.pct ?? 100;
  useEffect(() => { if (q.data) setPct(q.data.pct); }, [q.data]);

  const save = async (value: number) => {
    setBusy(true);
    setError(null);
    try {
      await trpcClient.admin.setCartelStrength.mutate({ pct: value });
      await queryClient.invalidateQueries(trpc.admin.cartelStrength.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Kartell-Stärke" right={<span className="mono text-sm">{saved} %</span>}>
      <p className="text-xs text-ink2 mb-3">
        Skaliert die Stärke aller Kartell-Überfälle, die ab jetzt auslaufen. 100 % ist der Wert aus der Balance.
        Wie oft das Kartell gewinnt, steht unter Statistik → Kampf.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          aria-label="Kartell-Stärke in Prozent"
          className="flex-1 h-11"
          style={{ accentColor: "var(--color-siegel)" }}
        />
        <span className="mono text-base w-14 text-right" aria-live="polite">{pct} %</span>
      </div>
      <div className="relative h-4 mono text-[10.5px] text-ink2 -mt-1 mb-2 mr-[68px]">
        <span className="absolute left-0">{MIN} %</span>
        {/* Marke an der echten Position von 100 % (Skala 25–300 ist nicht mittig um 100). */}
        <span className="absolute -translate-x-1/2" style={{ left: `${((100 - MIN) / (MAX - MIN)) * 100}%` }}>│100 %</span>
        <span className="absolute right-0">{MAX} %</span>
      </div>
      <p className="text-sm mb-3">{hint(pct)}</p>
      <div className="flex gap-2">
        <Button disabled={busy || pct === saved} onClick={() => save(pct)}>Speichern</Button>
        <Button kind="secondary" disabled={busy || saved === 100} onClick={() => { setPct(100); void save(100); }}>Zurück auf 100 %</Button>
      </div>
      {error && <ErrorLine text={error} />}
    </Card>
  );
}
