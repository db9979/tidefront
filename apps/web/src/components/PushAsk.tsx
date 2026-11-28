// Push im Moment des Nutzens (UX 0.43, A7 / S-3): einmalig nach dem ersten Bau bzw. der ersten Mission fragen
// („Soll ich dir Bescheid sagen, wenn …?“). Auf dem iPhone außerhalb der Home-Bildschirm-App nur der Hinweis, wie es
// geht. Mit „Ja“ wird die Ruhezeit auf das Nachtschild-Fenster vorbelegt (falls noch keine gesetzt ist). Nach „Nein“,
// nach einer Ablehnung im Browser oder mit bestehendem Abo wird nie wieder gefragt (localStorage je Gerät).
import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { currentEndpoint, enablePush, isIos, isStandalone, pushDenied, pushSupported } from "../lib/push.ts";
import { failText } from "../lib/names.ts";
import { Button, Sheet } from "../ui.tsx";
import { Icon } from "../icons.tsx";

const ASKED = "tf-push-asked";
type Trigger = "bau" | "mission";
let pending: Trigger | null = null;
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) f(); };

/** Schon gefragt (oder abgelehnt/blockiert)? Dann nie wieder. */
export function pushAsked(): boolean {
  try { return localStorage.getItem(ASKED) !== null; } catch { return true; }
}

/** Nach dem ersten erfolgreichen Bau bzw. der ersten Mission aufrufen; fragt höchstens einmal je Gerät. */
export function askPushAfter(t: Trigger): void {
  if (pending || pushAsked()) return;
  if (pushDenied()) { try { localStorage.setItem(ASKED, "blockiert"); } catch { /* egal */ } return; }
  if (!pushSupported() && !isIos()) return; // ohne Push und ohne Aussicht darauf: nicht fragen
  // Abo dieses Geräts prüfen (höchstens 3 s; ohne Antwort oder bei Fehlern gilt: kein Abo).
  const ep = Promise.race([currentEndpoint().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
  void ep.then((e) => {
    if (e) { try { localStorage.setItem(ASKED, "abo"); } catch { /* egal */ } return; }
    if (pending || pushAsked()) return;
    pending = t;
    emit();
  });
}

function usePending(): Trigger | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => pending);
}

const QUESTION: Record<Trigger, string> = {
  bau: "Soll ich dir Bescheid sagen, wenn der Bau fertig ist?",
  mission: "Soll ich dir Bescheid sagen, wenn dein Verband zurück ist?",
};

/** Einmal in der App eingebunden (App.tsx). */
export function PushAsk({ nightStartHour, nightHours = 8 }: { nightStartHour: number | null; nightHours?: number }) {
  const t = usePending();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({ ...trpc.push.status.queryOptions({ endpoint: null }), enabled: t !== null });
  const quiet = useQuery({ ...trpc.push.quiet.queryOptions(), enabled: t !== null });
  useEffect(() => { if (t) setError(null); }, [t]);
  if (!t) return null;
  const done = (why: string) => { try { localStorage.setItem(ASKED, why); } catch { /* egal */ } pending = null; emit(); };
  const iosHint = isIos() && !isStandalone();
  const yes = async () => {
    setBusy(true);
    setError(null);
    try {
      const key = status.data?.publicKey;
      if (!key) { setError("Auf dem Server sind keine Push-Schlüssel eingerichtet."); return; }
      const r = await enablePush(key);
      if (!r.ok) { setError(r.error); if (pushDenied()) done("blockiert"); return; }
      // Ruhezeit im Nachtschild-Fenster vorbelegen, falls noch keine eingeschaltet ist.
      if (nightStartHour !== null && quiet.data && !quiet.data.on) {
        const from = nightStartHour * 60;
        await trpcClient.push.setQuiet.mutate({ on: true, fromMin: from, toMin: (from + nightHours * 60) % 1440 }).catch(() => {});
      }
      await queryClient.invalidateQueries(trpc.push.pathFilter());
      done("ja");
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  };
  const quietText = nightStartHour !== null
    ? ` Nachts (${String(nightStartHour).padStart(2, "0")}–${String((nightStartHour + nightHours) % 24).padStart(2, "0")} Uhr, dein Nachtschild) sammle ich alles und melde mich morgens – außer bei Angriffen.`
    : "";
  return (
    <Sheet open onClose={() => done("nein")} title="Benachrichtigen?" icon={<Icon id="uhr" size={36} />}>
      <div data-testid="push-ask">
        <p className="font-serif text-[17px] leading-snug mb-2">{QUESTION[t]}</p>
        {iosHint ? (
          <>
            <p className="text-sm text-ink2 mb-3">Auf dem iPhone geht das nur aus der App auf dem Home-Bildschirm: im Browser auf „Teilen“ tippen, „Zum Home-Bildschirm“ wählen und TIDEFRONT von dort öffnen. Dann fragen wir noch einmal nach (Einstellungen → Benachrichtigungen).</p>
            <Button className="w-full" onClick={() => done("ios")}>Verstanden</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink2 mb-3">Bau fertig, Verband zurück, Angriff erkannt – kurz aufs Handy.{quietText} Jederzeit änderbar unter Einstellungen.</p>
            {error && <p className="text-sm text-siegel mb-2" role="alert">{error}</p>}
            <div className="flex gap-2">
              <Button kind="secondary" className="flex-1" onClick={() => done("nein")}>Nein danke</Button>
              <Button className="flex-1" disabled={busy} onClick={() => void yes()}>{busy ? "Moment …" : "Ja, Bescheid sagen"}</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
