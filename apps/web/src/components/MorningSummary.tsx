// Einstellungen des Morgenberichts (täglich per E-Mail, optional Push) bei den E-Mail-Einstellungen.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { errorText } from "../lib/names.ts";
import { Card, ErrorLine } from "../ui.tsx";
import { Switch } from "./Switch.tsx";

const pad = (n: number) => String(n).padStart(2, "0");
const toTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

export function SummaryCard() {
  const q = useQuery(trpc.comfort.summary.queryOptions());
  const acc = useQuery(trpc.account.get.queryOptions());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = q.data;
  if (!s) return null;
  const verified = !!acc.data?.email.verified;
  const zone = deviceZone();

  const save = async (patch: Partial<{ enabled: boolean; minuteOfDay: number; timeZone: string; push: boolean }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await trpcClient.comfort.setSummary.mutate({ enabled: s.enabled, minuteOfDay: s.minuteOfDay, timeZone: s.timeZone, push: s.push, ...patch });
      if (!r.ok) setError(r.code === "bad_tz" ? "Unbekannte Zeitzone." : r.code === "bad_time" ? "Ungültige Uhrzeit." : errorText(r.code));
      await queryClient.invalidateQueries(trpc.comfort.summary.pathFilter());
    } catch {
      setError(errorText("network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Morgenbericht">
      <p className="text-sm text-slate-300 mb-2">Einmal am Tag eine Zusammenfassung: Kämpfe mit Ergebnis, Beute und Verluste, fertige Aufträge, Lieferungen, neue Nachrichten und dein Rang in der Saison.</p>
      <Switch label="Morgenbericht per E-Mail" on={s.enabled} disabled={busy} onChange={(v) => void save({ enabled: v, ...(v && zone && s.lastSentAtMs === null ? { timeZone: zone } : {}) })} />
      {s.enabled && (
        <div className="mt-2 space-y-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Uhrzeit</span>
            <input
              type="time"
              step={900}
              className="h-11 rounded-lg field px-2 mono"
              value={toTime(s.minuteOfDay)}
              disabled={busy}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                if (Number.isInteger(h) && Number.isInteger(m)) void save({ minuteOfDay: h * 60 + m });
              }}
            />
          </label>
          <div className="text-xs text-slate-400 flex items-center justify-between gap-2">
            <span>Zeitzone {s.timeZone}</span>
            {zone && zone !== s.timeZone && <button type="button" className="tap text-see underline" onClick={() => void save({ timeZone: zone })}>{zone} übernehmen</button>}
          </div>
          <Switch label="Zusätzlich als Push" on={s.push} disabled={busy} onChange={(v) => void save({ push: v })} />
          {!verified && <p className="text-xs text-brass-300">Ohne bestätigte E-Mail-Adresse kommt der Bericht nur als Push (falls eingeschaltet).</p>}
        </div>
      )}
      <ErrorLine text={error} />
    </Card>
  );
}
