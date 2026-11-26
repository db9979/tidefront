// Einstellungen: Benachrichtigungen (Push, E-Mail), Freunde einladen, Passwort, Zugang zur Verwaltung.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { currentEndpoint, DENIED_HINT, disablePush, enablePush, isIos, isStandalone, KIND_LABEL, pushDenied, pushSupported } from "../lib/push.ts";
import { Badge, Button, Card, ErrorLine } from "../ui.tsx";
import { AdminScreen } from "./Admin.tsx";
import { useBackLayer } from "../lib/back.ts";
import { Switch } from "../components/Switch.tsx";
import { InvitePanel } from "../components/Invite.tsx";
import { SummaryCard } from "../components/MorningSummary.tsx";
import { requestBugReport } from "../lib/bug-log.ts";
import { TickerSetting } from "../components/market/TickerBar.tsx";

const field = "w-full h-12 rounded-lg field px-3 mb-3";

/** Arten für Push bzw. E-Mail; Marktnachrichten gibt es nur als Push. */
function kinds(isAdmin: boolean, mail = false): string[] {
  return Object.keys(KIND_LABEL).filter((k) => (k !== "ops" || isAdmin) && !(mail && k === "market"));
}

function PushCard({ isAdmin }: { isAdmin: boolean }) {
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void currentEndpoint().then(setEndpoint).catch(() => setEndpoint(null)), []);
  const status = useQuery({ ...trpc.push.status.queryOptions({ endpoint: endpoint ?? null }), enabled: endpoint !== undefined });
  const s = status.data;
  const ios = isIos();
  const blockedIos = ios && !isStandalone();
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
    <Card title="Push-Benachrichtigungen" right={s?.subscribed ? <Badge tone="green">aktiv</Badge> : <Badge>aus</Badge>}>
      {blockedIos && (
        <p className="text-sm text-brass-300 mb-2">
          iPhone und iPad: Benachrichtigungen gibt es nur in der installierten App (ab iOS 16.4). In Safari „Teilen“ → „Zum Home-Bildschirm“
          wählen, TIDEFRONT vom Home-Bildschirm öffnen und hier aktivieren.
        </p>
      )}
      {!pushSupported() && !blockedIos && <p className="text-sm text-slate-300 mb-2">Dieser Browser unterstützt keine Push-Benachrichtigungen.</p>}
      {pushSupported() && !s?.subscribed && (
        <>
          <p className="text-sm text-slate-300 mb-2">Meldungen auf diesem Gerät, auch wenn die App geschlossen ist: Angriffe, Kampfberichte, fertige Aufträge.</p>
          {pushDenied() && !error && <p className="text-sm text-siegel mb-2">{DENIED_HINT}</p>}
          {status.isError && <p className="text-sm text-siegel mb-2">{errorText("network")}</p>}
          <Button onClick={enable} disabled={busy || blockedIos || !s} className="w-full">Benachrichtigungen aktivieren</Button>
        </>
      )}
      {s?.subscribed && (
        <>
          <div className="divide-y divide-navy-600/70 mb-3">
            {kinds(isAdmin).map((k) => (
              <Switch key={k} label={KIND_LABEL[k]} on={s.prefs[k as keyof typeof s.prefs] ?? true} onChange={(v) => toggle(k, v)} disabled={busy} />
            ))}
          </div>
          <div className="flex gap-2">
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

function EmailCard({ isAdmin }: { isAdmin: boolean }) {
  const acc = useQuery(trpc.account.get.queryOptions());
  const e = acc.data?.email;
  const [addr, setAddr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = addr ?? e?.email ?? "";
  const refresh = () => queryClient.invalidateQueries(trpc.account.pathFilter());

  const save = async (remove = false) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await trpcClient.account.setEmail.mutate({ email: remove ? null : value });
      if (!r.ok) setError(errorText(r.code));
      else {
        setAddr(null);
        setMsg(remove ? "Adresse entfernt." : r.sent ? "Bestätigungslink gesendet. Bitte im Postfach öffnen (24 Stunden gültig)." : "Gespeichert, aber der Versand des Links ist fehlgeschlagen.");
      }
      await refresh();
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (kind: string, on: boolean) => {
    if (!e) return;
    await trpcClient.account.setEmailPrefs.mutate({ prefs: { ...e.prefs, [kind]: on } }).catch((err) => setError(failText(err)));
    await refresh();
  };

  return (
    <Card title="E-Mail" right={e?.email ? (e.verified ? <Badge tone="green">bestätigt</Badge> : <Badge tone="brass">unbestätigt</Badge>) : undefined}>
      {e && !e.mailReady && !e.email && <p className="text-sm text-slate-300">Der E-Mail-Versand ist auf diesem Server nicht eingerichtet.</p>}
      {e && (e.mailReady || e.email) && (
        <>
          <p className="text-sm text-slate-300 mb-2">Optional. Angriffe und Kampfberichte kommen sofort, fertige Aufträge gesammelt (höchstens alle 30 Minuten). Mit bestätigter Adresse geht auch „Passwort vergessen“ per E-Mail.</p>
          <label className="text-sm text-slate-300" htmlFor="tf-email">Adresse</label>
          <input id="tf-email" className={field} maxLength={254} type="email" inputMode="email" autoComplete="email" value={value} onChange={(ev) => setAddr(ev.target.value)} />
          <div className="flex gap-2 mb-2">
            <Button onClick={() => save()} disabled={busy || !value || (value === e.email && e.verified)} className="flex-1">
              {e.email && value === e.email && !e.verified ? "Link erneut senden" : "Speichern und bestätigen"}
            </Button>
            {e.email && <Button kind="ghost" onClick={() => save(true)} disabled={busy}>Entfernen</Button>}
          </div>
          {e.verified && (
            <div className="divide-y divide-navy-600/70">
              {kinds(isAdmin, true).map((k) => (
                <Switch key={k} label={KIND_LABEL[k]} on={e.prefs[k as keyof typeof e.prefs] ?? false} onChange={(v) => void toggle(k, v)} />
              ))}
            </div>
          )}
        </>
      )}
      {msg && <p className="text-sm text-emerald-300 mt-2">{msg}</p>}
      <ErrorLine text={error} />
    </Card>
  );
}

function PasswordCard() {
  const [oldPw, setOld] = useState("");
  const [newPw, setNew] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    setMsg(null);
    if (newPw.length < 8) return setError("Neues Passwort zu kurz (mindestens 8 Zeichen).");
    setBusy(true);
    try {
      const r = await trpcClient.account.changePassword.mutate({ oldPassword: oldPw, newPassword: newPw });
      if (!r.ok) setError(errorText(r.code));
      else {
        setOld("");
        setNew("");
        setMsg("Passwort geändert. Andere Geräte sind abgemeldet.");
      }
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Passwort ändern">
      <form onSubmit={submit}>
        <label className="text-sm text-slate-300" htmlFor="tf-old">Bisheriges Passwort</label>
        <input id="tf-old" className={field} maxLength={200} type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOld(e.target.value)} required />
        <label className="text-sm text-slate-300" htmlFor="tf-new">Neues Passwort (mind. 8 Zeichen)</label>
        <input id="tf-new" className={field} type="password" autoComplete="new-password" minLength={8} maxLength={200} value={newPw} onChange={(e) => setNew(e.target.value)} required />
        <Button type="submit" disabled={busy} className="w-full">Passwort ändern</Button>
      </form>
      {msg && <p className="text-sm text-emerald-300 mt-2">{msg}</p>}
      <ErrorLine text={error} />
    </Card>
  );
}

export function SettingsScreen({ onClose, initialAdmin = false, onAdmin }: { onClose: () => void; initialAdmin?: boolean; onAdmin?: (open: boolean) => void }) {
  const me = useQuery(trpc.auth.me.queryOptions());
  const isAdmin = !!me.data?.player?.isAdmin;
  const [admin, setAdminState] = useState(initialAdmin);
  const setAdmin = (a: boolean) => { setAdminState(a); onAdmin?.(a); };
  useBackLayer(admin && isAdmin, () => setAdmin(false), 3);
  if (admin && isAdmin) return <AdminScreen onClose={() => setAdmin(false)} />;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display text-2xl font-bold uppercase">Einstellungen</h1>
        <Button kind="secondary" onClick={onClose}>Zurück</Button>
      </div>
      <Card title="Börsen-Kurszeile">
        <p className="text-sm text-slate-300 mb-2">Die laufende Kurszeile der Börse auf allen Bildschirmen zeigen – fest oben unter den Ressourcen oder ganz unten über der Navigation. Antippen öffnet die Börse.</p>
        <TickerSetting />
      </Card>
      <PushCard isAdmin={isAdmin} />
      <EmailCard isAdmin={isAdmin} />
      {/* Einklappbar: selten gebraucht, aber lang. */}
      <Card title="Freunde einladen" collapsible storageKey="einstellungen-einladen" defaultOpen={false} summary="Einladungslink oder E-Mail an Freunde schicken."><InvitePanel playerName={me.data?.player?.name} /></Card>
      <SummaryCard />
      <PasswordCard />
      <Card title="Fehler melden">
        <p className="text-sm text-slate-300 mb-2">Schickt der Verwaltung einen Entwurf mit Screenshot der Spielansicht, Version, Gerät und Log. Du prüfst und ergänzt vor dem Senden.</p>
        <Button kind="secondary" onClick={requestBugReport} className="w-full">Fehler melden</Button>
      </Card>
      {isAdmin && (
        <Card title="Verwaltung">
          <p className="text-sm text-slate-300 mb-2">Einladungscodes, Einladungen der Spieler, Spieler, Passwort-Rücksetzcodes, E-Mail-Versand und Systemzustand.</p>
          <Button kind="secondary" onClick={() => setAdmin(true)} className="w-full">Verwaltung öffnen</Button>
        </Card>
      )}
    </div>
  );
}
