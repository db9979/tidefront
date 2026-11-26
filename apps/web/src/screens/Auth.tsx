import { useState } from "react";
import { ChangelogSheet, VersionLine } from "../components/Changelog.tsx";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { Button, ErrorLine } from "../ui.tsx";

type Mode = "login" | "register" | "forgot";

/** Token aus dem E-Mail-Link (/?reset=…). */
function resetTokenFromUrl(): string {
  const t = new URLSearchParams(location.search).get("reset") ?? "";
  return /^[0-9a-f]{64}$/.test(t) ? t : "";
}

/** Persönlicher Einladungscode aus dem Link der Einladung (/?invite=…). */
function inviteFromUrl(): string {
  const c = (new URLSearchParams(location.search).get("invite") ?? "").trim();
  return /^[A-Za-z0-9_-]{3,64}$/.test(c) ? c : "";
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
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };
  const reset = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("Passwort zu kurz (mindestens 8 Zeichen).");
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
        <input id="fg-name" className={field} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required={!linkToken} />
        {!linkToken && (
          <>
            <Button kind="secondary" onClick={() => void requestMail()} disabled={busy} className="w-full mb-4">Link per E-Mail senden</Button>
            <label className="text-sm text-slate-300" htmlFor="fg-code">Rücksetzcode</label>
            <input id="fg-code" className={field} maxLength={64} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="one-time-code" required />
          </>
        )}
        <label className="text-sm text-slate-300" htmlFor="fg-pw">Neues Passwort (mind. 8 Zeichen)</label>
        <input id="fg-pw" className={field} type="password" minLength={8} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        <Button type="submit" disabled={busy} className="w-full">Passwort neu setzen</Button>
      </form>
      {msg && <p className="text-sm text-emerald-300 mt-2">{msg}</p>}
      <ErrorLine text={error} />
    </>
  );
}

export function AuthScreen() {
  const [linkInvite] = useState(inviteFromUrl);
  const [mode, setMode] = useState<Mode>(() => (resetTokenFromUrl() ? "forgot" : linkInvite ? "register" : "login"));
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState(linkInvite);
  // Nur der Name des Einladenden (öffentlich, ratenbegrenzt).
  const inviter = useQuery({ ...trpc.invite.lookup.queryOptions({ code: linkInvite }), enabled: !!linkInvite, staleTime: Infinity, retry: false });
  const inviterName = invite.trim() === linkInvite ? inviter.data?.inviterName ?? null : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register") {
      const n = name.trim();
      if (n.length < 3 || n.length > 24) return setError(`Name ${n.length < 3 ? "zu kurz (mindestens 3" : "zu lang (höchstens 24"} Zeichen).`);
      if (!/^[\p{L}\p{N} _.-]+$/u.test(n)) return setError("Name: nur Buchstaben, Ziffern, Leerzeichen und _ . -");
      if (password.length < 8) return setError("Passwort zu kurz (mindestens 8 Zeichen).");
    }
    setBusy(true);
    try {
      const r =
        mode === "login"
          ? await trpcClient.auth.login.mutate({ name, password })
          : await trpcClient.auth.register.mutate({ name, password, inviteCode: invite });
      if (!r.ok) setError(errorText(r.code));
      else {
        if (linkInvite) history.replaceState(null, "", "/");
        await queryClient.invalidateQueries(trpc.auth.pathFilter());
      }
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full h-12 rounded-lg field px-3 mb-3";
  return (
    <div className="min-h-full flex flex-col justify-center p-5 max-w-sm mx-auto">
      <img src="/icon.svg" alt="" className="w-20 h-20 mx-auto mb-4 rounded-[18px] border border-rule" />
      <h1 className="font-serif !text-[38px] text-center !tracking-[0.18em] mb-1">TIDEFRONT</h1>
      <div className="flex items-center gap-2 mx-8 mb-2" aria-hidden="true"><i className="flex-1 border-t-[3px] border-double border-ink" /><span className="diamond bg-siegel" /><i className="flex-1 border-t-[3px] border-double border-ink" /></div>
      <p className="text-center text-ink2 mb-8 font-serif italic">Seekrieg auf Nordatlantik und Mittelmeer</p>
      <div className="grid grid-cols-2 mb-4 rounded-[3px] overflow-hidden border border-ink">
        {(["login", "register"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`tap font-display uppercase text-sm tracking-wider ${mode === m ? "bg-ink text-paper" : "bg-card text-ink2"}`}>
            {m === "login" ? "Anmelden" : "Registrieren"}
          </button>
        ))}
      </div>
      {mode === "forgot" ? (
        <>
          <h2 className="font-serif text-xl mb-2">Passwort vergessen</h2>
          <ForgotForm field={field} onDone={() => setMode("login")} />
        </>
      ) : (
        <form onSubmit={submit}>
          {mode === "register" && inviterName && (
            <div className="rounded-[3px] border border-ink bg-card px-3 py-2 mb-4 flex items-center gap-2" role="status">
              <span className="diamond bg-siegel shrink-0" aria-hidden="true" />
              <span className="text-sm">Eingeladen von <strong>{inviterName}</strong>. Wähle einen Namen und ein Passwort.</span>
            </div>
          )}
          <label htmlFor="au-name" className="text-[11px] font-display uppercase tracking-wider text-slate-400">Name</label>
          <input id="au-name" className={field} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required />
          <label htmlFor="au-pw" className="text-[11px] font-display uppercase tracking-wider text-slate-400">Passwort{mode === "register" ? " (mind. 8 Zeichen)" : ""}</label>
          <input id="au-pw" className={field} maxLength={200} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
          {mode === "register" && (
            <>
              <label htmlFor="au-invite" className="text-[11px] font-display uppercase tracking-wider text-slate-400">Einladungscode</label>
              <input id="au-invite" className={field} maxLength={64} value={invite} onChange={(e) => setInvite(e.target.value)} autoCapitalize="characters" required />
            </>
          )}
          <Button type="submit" disabled={busy} className="w-full">{mode === "login" ? "Anmelden" : "Konto anlegen"}</Button>
          <ErrorLine text={error} />
          {mode === "login" && (
            <Button kind="ghost" onClick={() => { setError(null); setMode("forgot"); }} className="w-full mt-2">Passwort vergessen?</Button>
          )}
        </form>
      )}
      <AuthVersion />
    </div>
  );
}

function AuthVersion() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6">
      <VersionLine onOpen={() => setOpen(true)} />
      <ChangelogSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
