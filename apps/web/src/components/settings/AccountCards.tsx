// Einstellungen → Konto (UX-0.43 A6): Name, E-Mail-Adresse (Bestätigung, „Passwort vergessen“ per Mail), Passwort,
// Abmelden als Textlink (der Hauptort zum Abmelden ist das Menü).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../../lib/trpc.ts";
import { errorText, failText } from "../../lib/names.ts";
import { Badge, Button, Card, ErrorLine } from "../../ui.tsx";

const field = "w-full h-12 rounded-lg field px-3 mb-3";

export function EmailCard() {
  const acc = useQuery(trpc.account.get.queryOptions());
  const e = acc.data?.email;
  const [addr, setAddr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = addr ?? e?.email ?? "";

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
      await queryClient.invalidateQueries(trpc.account.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="E-Mail-Adresse" right={e?.email ? (e.verified ? <Badge tone="green">bestätigt</Badge> : <Badge tone="brass">unbestätigt</Badge>) : undefined}>
      {e && !e.mailReady && !e.email && <p className="text-sm text-slate-300">Der E-Mail-Versand ist auf diesem Server nicht eingerichtet.</p>}
      {e && (e.mailReady || e.email) && (
        <>
          <p className="text-sm text-slate-300 mb-2">Optional. Mit bestätigter Adresse gehen Benachrichtigungen, Morgenbericht und „Passwort vergessen“ per E-Mail.</p>
          <label className="text-sm text-slate-300" htmlFor="tf-email">Adresse</label>
          <input id="tf-email" className={field} maxLength={254} type="email" inputMode="email" autoComplete="email" value={value} onChange={(ev) => setAddr(ev.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save()} disabled={busy || !value || (value === e.email && e.verified)} className="flex-1">
              {e.email && value === e.email && !e.verified ? "Link erneut senden" : "Speichern und bestätigen"}
            </Button>
            {e.email && <Button kind="ghost" onClick={() => save(true)} disabled={busy}>Entfernen</Button>}
          </div>
        </>
      )}
      {msg && <p className="text-sm text-emerald-300 mt-2">{msg}</p>}
      <ErrorLine text={error} />
    </Card>
  );
}

export function PasswordCard() {
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
    <Card title="Passwort ändern" collapsible storageKey="einstellungen-passwort" defaultOpen={false} summary="Bisheriges und neues Passwort eingeben">
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
