// Verwaltung: E-Mail-Versand per SMTP (iCloud, Google, sonstiger Anbieter). Das Passwort kommt nie zurück.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { Badge, Button, Card, ErrorLine } from "../ui.tsx";
import { Switch } from "../components/Switch.tsx";

type Provider = "icloud" | "google" | "custom";
type Security = "ssl" | "starttls" | "none";

const PROVIDERS: { id: Provider; label: string; hint: string }[] = [
  { id: "icloud", label: "iCloud", hint: "smtp.mail.me.com, Port 587, STARTTLS. Benutzer ist die iCloud-Adresse; als Passwort ein app-spezifisches Passwort von account.apple.com." },
  { id: "google", label: "Google", hint: "smtp.gmail.com, Port 465 (SSL) oder 587 (STARTTLS). Als Passwort ein App-Passwort (Google-Konto → Sicherheit, Bestätigung in zwei Schritten nötig)." },
  { id: "custom", label: "Sonstiger SMTP", hint: "Host, Port und Verschlüsselung deines Anbieters." },
];

const input = "w-full h-11 rounded-lg field px-3 mb-2";

export function AdminMail() {
  const q = useQuery(trpc.admin.mail.queryOptions());
  const [f, setF] = useState<{
    enabled: boolean; provider: Provider; host: string; port: number; security: Security; user: string; fromName: string; fromAddress: string;
  } | null>(null);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data && !f) setF({ ...q.data.config, provider: q.data.config.provider as Provider, security: q.data.config.security as Security });
  }, [q.data, f]);
  if (!q.data || !f) return null;
  const d = q.data;
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const pick = (p: Provider) => {
    if (p === "icloud") set({ provider: p, host: "smtp.mail.me.com", port: 587, security: "starttls" });
    else if (p === "google") set({ provider: p, host: "smtp.gmail.com", port: 465, security: "ssl" });
    else set({ provider: p });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      await queryClient.invalidateQueries(trpc.admin.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };
  /** Pflichtfelder vor dem Speichern prüfen (nur bei aktivem Versand; ausgeschaltet darf es unvollständig sein). */
  const missing = (): string | null => {
    if (!f.enabled) return null;
    if (!f.host.trim()) return "Host fehlt.";
    if (!Number.isInteger(f.port) || f.port < 1 || f.port > 65535) return "Port fehlt oder ist ungültig (1–65535).";
    if (!f.user.trim()) return "Benutzer fehlt.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.fromAddress.trim())) return "Absenderadresse fehlt oder ist ungültig.";
    return null;
  };
  const save = (clearPassword = false) => run(async () => {
    const m = missing();
    if (m) return setError(m);
    const r = await trpcClient.admin.saveMail.mutate({ ...f, password: clearPassword ? "" : password || undefined });
    if (!r.ok) return setError(errorText(r.code));
    setPassword("");
    setMsg("Gespeichert.");
  });
  const test = () => run(async () => {
    const r = await trpcClient.admin.testMail.mutate();
    if (r.ok) setMsg("Test-E-Mail gesendet. Bitte Postfach prüfen.");
    else setError(r.code === "no_email" ? "Erst in den Einstellungen eine eigene E-Mail-Adresse hinterlegen." : `${errorText(r.code)}${"error" in r && r.error ? ` (${r.error})` : ""}`);
  });

  const hint = PROVIDERS.find((p) => p.id === f.provider)!.hint;
  return (
    <Card title="E-Mail-Versand" right={d.config.enabled && d.secretAvailable ? <Badge tone="green">aktiv</Badge> : <Badge>aus</Badge>}>
      {!d.secretAvailable && (
        <p className="text-sm text-brass-300 mb-2">
          E-Mail ist abgeschaltet: Auf dem Server fehlt die Umgebungsvariable APP_SECRET (Schlüssel für das gespeicherte SMTP-Passwort).
          In .env setzen (z. B. mit „openssl rand -hex 32“ erzeugen) und „docker compose up -d“ ausführen.
        </p>
      )}
      <fieldset disabled={!d.secretAvailable || busy}>
        <Switch label="E-Mail-Versand aktiv" on={f.enabled} onChange={(v) => set({ enabled: v })} />
        <div className="grid grid-cols-3 my-2 rounded-lg overflow-hidden border border-navy-600">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p.id)} className={`tap text-sm ${f.provider === p.id ? "bg-ink text-paper" : "bg-navy-900 text-slate-400"}`}>{p.label}</button>
          ))}
        </div>
        <p className="text-xs text-slate-400 mb-2">{hint}</p>
        {f.provider === "custom" && (
          <>
            <label className="text-sm text-slate-300" htmlFor="smtp-host">Host</label>
            <input id="smtp-host" className={input} maxLength={200} required value={f.host} onChange={(e) => set({ host: e.target.value })} autoCapitalize="none" />
          </>
        )}
        {f.provider !== "icloud" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm text-slate-300" htmlFor="smtp-port">Port</label>
              <input id="smtp-port" className={input} inputMode="numeric" maxLength={5} required value={f.port || ""} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, "").slice(0, 5)) || 0 })} />
            </div>
            <div>
              <label className="text-sm text-slate-300" htmlFor="smtp-sec">Verschlüsselung</label>
              <select id="smtp-sec" className={input} value={f.security} onChange={(e) => set({ security: e.target.value as Security })}>
                <option value="ssl">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
                {f.provider === "custom" && <option value="none">keine</option>}
              </select>
            </div>
          </div>
        )}
        <label className="text-sm text-slate-300" htmlFor="smtp-user">Benutzer</label>
        <input id="smtp-user" className={input} maxLength={200} required value={f.user} onChange={(e) => set({ user: e.target.value })} autoCapitalize="none" autoComplete="off" />
        <label className="text-sm text-slate-300" htmlFor="smtp-pass">Passwort {d.passwordSet && <span className="text-xs text-emerald-300">(gesetzt – leer lassen zum Behalten)</span>}</label>
        <input id="smtp-pass" className={input} maxLength={500} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <label className="text-sm text-slate-300" htmlFor="smtp-name">Absendername</label>
        <input id="smtp-name" className={input} maxLength={80} value={f.fromName} onChange={(e) => set({ fromName: e.target.value })} />
        <label className="text-sm text-slate-300" htmlFor="smtp-from">Absenderadresse</label>
        <input id="smtp-from" className={input} type="email" maxLength={254} required value={f.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} autoCapitalize="none" />
        {/* Zwei gleich breite, einzeilige Knöpfe – auch auf schmalen iPhones kein Umbruch. */}
        <div className="grid grid-cols-2 gap-2 mt-1">
          <Button onClick={() => save()} className="whitespace-nowrap px-2 tracking-[0.06em]">Speichern</Button>
          <Button kind="secondary" onClick={test} className="whitespace-nowrap px-2 tracking-[0.06em]">Testmail</Button>
          {d.passwordSet && <Button kind="ghost" onClick={() => save(true)} className="col-span-2 whitespace-nowrap tracking-[0.06em]">Passwort löschen</Button>}
        </div>
        <ErrorLine text={error} />
      </fieldset>
      <p className="text-xs text-slate-400 mt-2">
        Letzter Versand: {d.lastSentAt ? new Date(d.lastSentAt).toLocaleString("de-DE") : "–"}
        {d.lastError && <> · Letzter Fehler ({new Date(d.lastError.at).toLocaleString("de-DE")}): {d.lastError.message}</>}
      </p>
      {msg && <p className="text-sm text-emerald-300 mt-2">{msg}</p>}
    </Card>
  );
}
