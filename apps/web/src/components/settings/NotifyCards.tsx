// Einstellungen → Benachrichtigungen (UX-0.43 A6): Push (zentrale Stelle zum Einschalten, auch Ziel der Push-Frage im
// Spielablauf: Einstellungen öffnen mit focus "push"), Ruhezeit (24-h-Format) und E-Mail-Benachrichtigungen. Die
// E-Mail-Schalter sind ohne eingerichteten Mailversand bzw. ohne bestätigte Adresse deaktiviert und nennen den Grund.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../../lib/trpc.ts";
import { errorText, failText } from "../../lib/names.ts";
import { currentEndpoint, DENIED_HINT, disablePush, enablePush, isIos, isStandalone, KIND_LABEL, pushDenied, pushSupported } from "../../lib/push.ts";
import { Badge, Button, Card, ErrorLine } from "../../ui.tsx";
import { Switch } from "../Switch.tsx";

/** Beschriftungen je Art, ergänzt um die Erinnerungen der Spielerbindung (retention.ts, winback.ts). */
const LABEL: Record<string, string> = {
  ...KIND_LABEL,
  daily: "Tagesbefehle bereit / Serie in Gefahr",
  idle: "Bauschlange leer",
  nest: "Nest wieder besetzt (zuletzt von dir besiegt)",
  comeback: "Rückkehr-Erinnerung und Saisonwechsel",
};

/** Arten für Push bzw. E-Mail; Marktnachrichten nur als Push (Rückkehr/Saisonwechsel seit AN-06 auch als Push). */
function kinds(isAdmin: boolean, mail = false): string[] {
  return Object.keys(LABEL).filter((k) => (k !== "ops" || isAdmin) && !(mail && k === "market"));
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** Stundenauswahl im 24-h-Format („07:00“, nie „07:00 AM“). */
export function HourSelect({ label, value, onChange, disabled, suffix = ":00" }: { label: string; value: number; onChange: (h: number) => void; disabled?: boolean; /** "" bei eigener Minutenauswahl daneben */ suffix?: string }) {
  return (
    <select aria-label={label} className="h-11 rounded-lg field px-2 mono" value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad2(h)}{suffix}</option>)}
    </select>
  );
}

export function PushCard({ isAdmin }: { isAdmin: boolean }) {
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void currentEndpoint().then(setEndpoint).catch(() => setEndpoint(null)), []);
  const status = useQuery({ ...trpc.push.status.queryOptions({ endpoint: endpoint ?? null }), enabled: endpoint !== undefined });
  const s = status.data;
  const blockedIos = isIos() && !isStandalone();
  const refresh = () => queryClient.invalidateQueries(trpc.push.pathFilter());

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };
  const enable = () => run(async () => {
    if (!s?.publicKey) return setError("Auf dem Server sind keine Push-Schlüssel eingerichtet.");
    const r = await enablePush(s.publicKey);
    if (!r.ok) return setError(r.error);
    setEndpoint(r.endpoint);
    await refresh();
  });
  const disable = () => run(async () => {
    await disablePush();
    setEndpoint(null);
    await refresh();
  });
  const toggle = (kind: string, on: boolean) => run(async () => {
    if (!endpoint || !s) return;
    await trpcClient.push.setPrefs.mutate({ endpoint, prefs: { ...s.prefs, [kind]: on } });
    await refresh();
  });
  const test = () => run(async () => {
    const r = await trpcClient.push.test.mutate();
    if (r.ok) setMsg(`Testnachricht an ${r.sent} ${r.sent === 1 ? "Gerät" : "Geräte"} gesendet.`);
    else setError(r.code === "rate" ? errorText("rate") : "Keine Testnachricht zugestellt. Ist ein Gerät angemeldet?");
  });

  return (
    <Card id="einstellungen-push" title="Push auf diesem Gerät" right={s?.subscribed ? <Badge tone="green">aktiv</Badge> : <Badge>aus</Badge>}>
      {!s?.subscribed && <p className="text-sm text-slate-300 mb-2">Bescheid bekommen, wenn etwas passiert – auch bei geschlossener App.</p>}
      {!s?.subscribed && (
        <details className="text-xs text-ink2 mb-2">
          <summary className="cursor-pointer">Warum?</summary>
          <p className="mt-1">Angriffe, Kampfberichte und fertige Aufträge erreichen dich sofort. Routinemeldungen hält die Ruhezeit zurück; welche Arten kommen, wählst du nach dem Einschalten.</p>
        </details>
      )}
      {blockedIos && (
        <p className="text-sm text-brass-300 mb-2">
          iPhone/iPad: nur in der installierten App (ab iOS 16.4). In Safari „Teilen“ → „Zum Home-Bildschirm“, dann TIDEFRONT vom Home-Bildschirm öffnen.
        </p>
      )}
      {!pushSupported() && !blockedIos && <p className="text-sm text-slate-300 mb-2">Dieser Browser unterstützt keine Push-Benachrichtigungen.</p>}
      {pushSupported() && !s?.subscribed && (
        <>
          {pushDenied() && !error && <p className="text-sm text-siegel mb-2">{DENIED_HINT}</p>}
          {status.isError && <p className="text-sm text-siegel mb-2">{errorText("network")}</p>}
          <Button onClick={enable} disabled={busy || blockedIos || !s} className="w-full">Benachrichtigungen aktivieren</Button>
        </>
      )}
      {s?.subscribed && (
        <>
          <div className="divide-y divide-navy-600/70 mb-3" role="group" aria-label="Push-Arten">
            {kinds(isAdmin).map((k) => (
              <Switch key={k} label={LABEL[k]} on={s.prefs[k as keyof typeof s.prefs] ?? true} onChange={(v) => toggle(k, v)} disabled={busy} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button kind="secondary" onClick={test} disabled={busy} className="flex-1">Testnachricht senden</Button>
            <Button kind="ghost" onClick={disable} disabled={busy}>Abschalten</Button>
          </div>
          {s.devices > 1 && <p className="text-xs text-slate-400 mt-2">Angemeldet auf {s.devices} Geräten; die Schalter gelten für dieses Gerät.</p>}
        </>
      )}
      {msg && <p className="text-sm text-emerald-300 mt-2">{msg}</p>}
      <ErrorLine text={error} />
    </Card>
  );
}

/** Ruhezeit für Pushes (alle Geräte): Routinemeldungen werden gesammelt und danach als ein Push zugestellt. */
export function QuietCard() {
  const q = useQuery(trpc.push.quiet.queryOptions());
  const [error, setError] = useState<string | null>(null);
  const d = q.data;
  const save = async (next: { on: boolean; fromMin: number; toMin: number }) => {
    setError(null);
    try {
      const r = await trpcClient.push.setQuiet.mutate(next);
      if (!r.ok) setError("Beginn und Ende der Ruhezeit müssen sich unterscheiden.");
      await queryClient.invalidateQueries(trpc.push.quiet.queryFilter());
    } catch (err) {
      setError(failText(err));
    }
  };
  return (
    <Card title="Ruhezeit für Push">
      <p className="text-sm text-slate-300 mb-2">
        Routinemeldungen kommen gesammelt danach, Angriffe immer sofort. Dein Nachtschild-Fenster gilt zusätzlich.
        {d ? ` Uhrzeiten in Spielzeit (${d.timeZone}).` : ""}
      </p>
      {d && (
        <>
          <Switch label="Ruhezeit an" on={d.on} onChange={(on) => void save({ ...d, on })} />
          <div className="flex flex-wrap gap-4 mt-2" data-quiet-hours>
            <label className="flex items-center gap-2 text-sm">von <HourSelect label="Ruhezeit von" value={Math.floor(d.fromMin / 60)} disabled={!d.on} onChange={(h) => void save({ ...d, fromMin: h * 60 })} /></label>
            <label className="flex items-center gap-2 text-sm">bis <HourSelect label="Ruhezeit bis" value={Math.floor(d.toMin / 60)} disabled={!d.on} onChange={(h) => void save({ ...d, toMin: h * 60 })} /></label>
          </div>
        </>
      )}
      <ErrorLine text={error} />
    </Card>
  );
}

/** Grund, warum E-Mail-Benachrichtigungen (noch) nicht gehen; null = gehen. */
export function mailBlocked(e: { mailReady: boolean; email: string | null; verified: boolean } | undefined): string | null {
  if (!e) return "Wird geladen …";
  if (!e.mailReady) return "Der E-Mail-Versand ist auf diesem Server nicht eingerichtet.";
  if (!e.email) return "Erst unter Konto eine E-Mail-Adresse eintragen und bestätigen.";
  if (!e.verified) return "Erst die E-Mail-Adresse bestätigen (Link im Postfach).";
  return null;
}

export function EmailNotifyCard({ isAdmin }: { isAdmin: boolean }) {
  const acc = useQuery(trpc.account.get.queryOptions());
  const e = acc.data?.email;
  const [error, setError] = useState<string | null>(null);
  const blocked = mailBlocked(e);
  const toggle = async (kind: string, on: boolean) => {
    if (!e) return;
    await trpcClient.account.setEmailPrefs.mutate({ prefs: { ...e.prefs, [kind]: on } }).catch((err) => setError(failText(err)));
    await queryClient.invalidateQueries(trpc.account.pathFilter());
  };
  return (
    <Card id="einstellungen-mailarten" title="E-Mail-Benachrichtigungen" collapsible storageKey="einstellungen-mailarten" defaultOpen={!blocked}
      summary={blocked ?? "Angriffe und Berichte sofort, Aufträge gesammelt"}>
      {blocked && <p className="text-sm text-brass-300 mb-2" data-testid="mail-blocked">{blocked}</p>}
      <p className="text-xs text-ink2 mb-1">Angriffe und Kampfberichte kommen sofort, fertige Aufträge gesammelt (höchstens alle 30 Minuten).</p>
      <div className="divide-y divide-navy-600/70" role="group" aria-label="E-Mail-Arten">
        {kinds(isAdmin, true).map((k) => (
          <Switch key={k} label={LABEL[k]} on={!blocked && (e?.prefs[k as keyof typeof e.prefs] ?? false)} disabled={!!blocked} onChange={(v) => void toggle(k, v)} />
        ))}
      </div>
      <ErrorLine text={error} />
    </Card>
  );
}
