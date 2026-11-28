// Lage „Nächster lohnender Besuch“ (UX-0.43 B8, L-5/W-4): eine Zeile mit Uhrzeit und Anlässen („13:52 · Verband
// zurück, Bauhof frei“) und „Erinnern“. Mit Push auf diesem Gerät stellt der Server eine Erinnerung zur Zeit
// (lage.remind, Ruhezeit gilt); sonst gibt es eine Kalenderdatei (ICS) – das geht auch auf dem iPhone ohne
// Home-Bildschirm-App. Server: lage.get → visit (engine/lage-visit.ts).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient, type Outputs } from "../../lib/trpc.ts";
import { currentEndpoint } from "../../lib/push.ts";
import { failText } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { downloadIcs, icsEvent } from "../../lib/ics.ts";
import { Icon } from "../../icons.tsx";
import { ErrorLine } from "../../ui.tsx";
import { clockOf } from "./LageList.tsx";

export type LageVisit = NonNullable<Outputs["lage"]["get"]["visit"]>;

/** Push auf diesem Gerät aktiv? (undefined: wird geprüft) */
function usePushActive(): boolean | undefined {
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    // Höchstens 3 s warten (ohne Service Worker kommt keine Antwort): dann gilt „kein Push“ → Kalenderdatei.
    void Promise.race([currentEndpoint().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 3000))]).then(setEndpoint);
  }, []);
  const status = useQuery({ ...trpc.push.status.queryOptions({ endpoint: endpoint ?? null }), enabled: !!endpoint });
  if (endpoint === undefined) return undefined;
  if (!endpoint) return false;
  return status.data ? status.data.subscribed : undefined;
}

export function visitText(v: LageVisit): string {
  return v.reasons.join(", ");
}

export function NextVisit({ visit, nowMs }: { visit: LageVisit | null; nowMs: number }) {
  const push = usePushActive();
  const reminder = useQuery(trpc.lage.reminder.queryOptions());
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!visit) return null;
  const at = clockOf(visit.atMs, nowMs);
  const set = reminder.data && Math.abs(reminder.data.atMs - visit.atMs) < 60_000;
  const remind = async () => {
    setError(null);
    setNote(null);
    const text = `${visitText(visit)} – ${at} Uhr`;
    if (push) {
      setBusy(true);
      try {
        const r = await trpcClient.lage.remind.mutate({ atMs: Math.round(visit.atMs), text });
        if (r.ok) setNote(`Erinnerung um ${at} gestellt (Push).`);
        else setError("Diese Zeit lässt sich nicht mehr vormerken.");
        await queryClient.invalidateQueries(trpc.lage.reminder.queryFilter());
      } catch (err) {
        setError(failText(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    downloadIcs("tidefront-besuch.ics", icsEvent({ startMs: visit.atMs, title: "TIDEFRONT: Zeit für einen Besuch", description: text, url: location.origin + "/?tab=lage" }));
    setNote("Kalendertermin erstellt – öffne die Datei, um ihn in deinen Kalender zu übernehmen.");
  };
  return (
    <section className="panel rounded-xl px-3.5 py-2.5 mb-3" aria-label="Nächster lohnender Besuch" data-testid="lage-visit">
      <div className="flex items-center gap-2.5">
        <Icon id="uhr" size={26} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-display uppercase tracking-[0.1em] text-ink2 leading-tight">Nächster lohnender Besuch</span>
          <span className="block text-sm leading-snug">
            <strong className="mono" data-testid="lage-visit-time">{at}</strong>
            <span className="text-ink2"> · in {fmtDuration(Math.max(0, visit.atMs - nowMs))}</span>
          </span>
          <span className="block text-xs text-ink2 truncate" data-testid="lage-visit-reasons">{visitText(visit)}</span>
        </span>
        {set ? <span className="text-xs text-moos shrink-0" data-testid="lage-visit-set">Erinnerung gestellt</span> : (
          <button type="button" data-testid="lage-visit-remind" title={push === false ? "Kalendertermin (ICS) – Push ist auf diesem Gerät aus" : "Push zur Zeit"} disabled={busy || push === undefined} onClick={() => void remind()}
            className="tap shrink-0 rounded-lg btn-quiet font-display uppercase tracking-[0.08em] text-[12px] px-2.5 py-2 disabled:opacity-50">
            Erinnern
          </button>
        )}
      </div>
      {note && <p className="text-xs text-moos mt-1.5" data-testid="lage-visit-note">{note}</p>}
      <ErrorLine text={error} />
    </section>
  );
}
