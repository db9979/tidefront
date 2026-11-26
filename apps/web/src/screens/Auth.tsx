import { useState } from "react";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText } from "../lib/names.ts";
import { Button, ErrorLine } from "../ui.tsx";

type Mode = "login" | "register" | "forgot";

/** Token aus dem E-Mail-Link (/?reset=…). */
function resetTokenFromUrl(): string {
  const t = new URLSearchParams(location.search).get("reset") ?? "";
  return /^[0-9a-f]{64}$/.test(t) ? t : "";
}

function ForgotForm({ field, onDone }: { field: string; onDone: () => void }) {
  const [linkToken] = useState(resetTokenFromUrl);
  const [name, setName] = useState("");
  const [code, setCode] = useState(linkToken);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
    } catch {
      setError("Eingaben prüfen: Rücksetzcode und neues Passwort (mind. 8 Zeichen).");
    } finally {
      setBusy(false);
    }
  };
  const reset = (e: React.FormEvent) => {
    e.preventDefault();
    void wrap(async () => {
      const r = await trpcClient.auth.resetPassword.mutate({ name: name.trim() || undefined, code, password });
      if (!r.ok) return setError(errorText(r.code));
      history.replaceState(null, "", "/");
      onDone();
      await queryClient.invalidateQueries(trpc.auth.pathFilter());
    });
  };
  const requestMail = () => wrap(async () => {
    if (!name.trim()) return setError("Bitte zuerst den Namen eingeben.");
    const r = await trpcClient.auth.requestReset.mutate({ name });
    if (!r.ok) return setError(errorText(r.code));
    setMsg("Wenn für dieses Konto eine bestätigte E-Mail-Adresse hinterlegt ist, ist ein Link unterwegs.");
  });

  return (
    <>
      {linkToken ? (
        <p className="text-sm text-slate-300 mb-3">Lege ein neues Passwort fest. Danach bist du angemeldet; andere Geräte werden abgemeldet.</p>
      ) : (
        <p className="text-sm text-slate-300 mb-3">
          Mit bestätigter E-Mail-Adresse kommt ein Link per E-Mail. Sonst gibt dir die Verwaltung einen Rücksetzcode (24 Stunden gültig).
        </p>
      )}
      <form onSubmit={reset}>
        <label className="text-sm text-slate-300" htmlFor="fg-name">Name{linkToken ? " (optional)" : ""}</label>
        <input id="fg-name" className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required={!linkToken} />
        {!linkToken && (
          <>
            <Button kind="secondary" onClick={() => void requestMail()} disabled={busy} className="w-full mb-4">Link per E-Mail senden</Button>
            <label className="text-sm text-slate-300" htmlFor="fg-code">Rücksetzcode</label>
            <input id="fg-code" className={field} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="one-time-code" required />
          </>
        )}
        <label className="text-sm text-slate-300" htmlFor="fg-pw">Neues Passwort (mind. 8 Zeichen)</label>
        <input id="fg-pw" className={field} type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        <Button type="submit" disabled={busy} className="w-full">Passwort neu setzen</Button>
      </form>
      {msg && <p className="text-sm text-emerald-300 mt-2">{msg}</p>}
      <ErrorLine text={error} />
    </>
  );
}

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>(() => (resetTokenFromUrl() ? "forgot" : "login"));
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === "login"
          ? await trpcClient.auth.login.mutate({ name, password })
          : await trpcClient.auth.register.mutate({ name, password, inviteCode: invite });
      if (!r.ok) setError(errorText(r.code));
      else await queryClient.invalidateQueries(trpc.auth.pathFilter());
    } catch (err) {
      const msg = String((err as Error).message ?? "");
      setError(msg.includes("password") || msg.includes("name") ? "Name (3–24 Zeichen) und Passwort (mind. 8 Zeichen) prüfen." : errorText("network"));
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full h-12 rounded-lg bg-navy-950 border border-navy-600 px-3 mb-3";
  return (
    <div className="min-h-full flex flex-col justify-center p-5 max-w-sm mx-auto">
      <img src="/icon.svg" alt="" className="w-16 h-16 mx-auto mb-4" />
      <h1 className="font-display text-3xl font-bold text-center uppercase tracking-[0.4em] mb-1">Tidefront</h1>
      <p className="text-center text-slate-500 mb-8 text-xs mono uppercase tracking-widest">Lagezentrum Nordatlantik · Mittelmeer</p>
      <div className="grid grid-cols-2 mb-4 rounded-lg overflow-hidden border border-navy-600">
        {(["login", "register"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`tap font-display uppercase text-sm tracking-wider ${mode === m ? "bg-navy-700 text-sea-300 border-b-2 border-sea-400" : "bg-navy-900 text-slate-500"}`}>
            {m === "login" ? "Anmelden" : "Registrieren"}
          </button>
        ))}
      </div>
      {mode === "forgot" ? (
        <>
          <h2 className="font-display font-bold uppercase text-sea-300 mb-2">Passwort vergessen</h2>
          <ForgotForm field={field} onDone={() => setMode("login")} />
        </>
      ) : (
        <form onSubmit={submit}>
          <label className="text-[11px] font-display uppercase tracking-wider text-slate-400">Name</label>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required />
          <label className="text-[11px] font-display uppercase tracking-wider text-slate-400">Passwort</label>
          <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
          {mode === "register" && (
            <>
              <label className="text-[11px] font-display uppercase tracking-wider text-slate-400">Einladungscode</label>
              <input className={field} value={invite} onChange={(e) => setInvite(e.target.value)} autoCapitalize="characters" required />
            </>
          )}
          <Button type="submit" disabled={busy} className="w-full">{mode === "login" ? "Anmelden" : "Konto anlegen"}</Button>
          <ErrorLine text={error} />
          {mode === "login" && (
            <Button kind="ghost" onClick={() => { setError(null); setMode("forgot"); }} className="w-full mt-2">Passwort vergessen?</Button>
          )}
        </form>
      )}
    </div>
  );
}
