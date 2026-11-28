// Einstellungen → Benachrichtigungen: Morgenbericht (einmal am Tag) mit Kanälen. E-Mail geht nur mit eingerichtetem
// Mailversand und bestätigter Adresse – sonst ist der Kanal deaktiviert und nennt den Grund (UX-0.43 A6); Push ist
// zuschaltbar. Uhrzeit im 24-h-Format (Stunde und Viertelstunde), nicht als Browser-Zeitfeld mit AM/PM.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { Card, ErrorLine, SmallButton } from "../ui.tsx";
import { Switch } from "./Switch.tsx";
import { HourSelect, mailBlocked, pad2 } from "./settings/NotifyCards.tsx";

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
  const blocked = mailBlocked(acc.data?.email);
  const zone = deviceZone();
  const h = Math.floor(s.minuteOfDay / 60);
  const m = s.minuteOfDay % 60;

  const save = async (patch: Partial<{ enabled: boolean; minuteOfDay: number; timeZone: string; push: boolean }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await trpcClient.comfort.setSummary.mutate({ enabled: s.enabled, minuteOfDay: s.minuteOfDay, timeZone: s.timeZone, push: s.push, ...patch });
      if (!r.ok) setError(r.code === "bad_tz" ? "Unbekannte Zeitzone." : r.code === "bad_time" ? "Ungültige Uhrzeit." : errorText(r.code));
      await queryClient.invalidateQueries(trpc.comfort.summary.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Morgenbericht">
      <p className="text-sm text-slate-300 mb-2">Einmal am Tag: Kämpfe, Beute und Verluste, fertige Aufträge, Lieferungen, neue Nachrichten und dein Rang.</p>
      <Switch label="Morgenbericht" on={s.enabled} disabled={busy} onChange={(v) => void save({ enabled: v, ...(v && zone && s.lastSentAtMs === null ? { timeZone: zone } : {}) })} />
      {s.enabled && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Uhrzeit</span>
            <span className="flex items-center gap-1">
              <HourSelect label="Morgenbericht Stunde" suffix="" value={h} disabled={busy} onChange={(nh) => void save({ minuteOfDay: nh * 60 + m })} />
              <span aria-hidden>:</span>
              <select aria-label="Morgenbericht Minute" className="h-11 rounded-lg field px-2 mono" value={m - (m % 15)} disabled={busy}
                onChange={(e) => void save({ minuteOfDay: h * 60 + Number(e.target.value) })}>
                {[0, 15, 30, 45].map((x) => <option key={x} value={x}>{pad2(x)}</option>)}
              </select>
            </span>
          </div>
          <div className="text-xs text-slate-400 flex items-center justify-between gap-2">
            <span>Zeitzone {s.timeZone}</span>
            {zone && zone !== s.timeZone && <SmallButton onClick={() => void save({ timeZone: zone })}>{zone} übernehmen</SmallButton>}
          </div>
          <div role="group" aria-label="Kanäle des Morgenberichts">
            <Switch label="per E-Mail" on={!blocked} disabled onChange={() => {}} />
            {blocked && <p className="text-xs text-brass-300 -mt-0.5 mb-1" data-testid="summary-mail-blocked">{blocked}</p>}
            <Switch label="als Push" on={s.push} disabled={busy} onChange={(v) => void save({ push: v })} />
          </div>
          {blocked && !s.push && <p className="text-xs text-siegel">Ohne E-Mail und ohne Push kommt kein Morgenbericht an.</p>}
        </div>
      )}
      <ErrorLine text={error} />
    </Card>
  );
}
