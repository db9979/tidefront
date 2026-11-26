import { useState } from "react";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText } from "../lib/names.ts";
import { Button, ErrorLine } from "../ui.tsx";

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register">("login");
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
      </form>
    </div>
  );
}
