// Verwaltung (nur Admins; der Server prüft jede Anfrage): Systemzustand, Einladungscodes, Spieler, E-Mail-Versand.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText } from "../lib/names.ts";
import { Badge, Button, Card, ErrorLine, Loading, StatTable, Stepper } from "../ui.tsx";
import { AdminMail } from "./AdminMail.tsx";
import { AdminInvites } from "./AdminInvites.tsx";

function when(v: string | Date | null | undefined): string {
  if (!v) return "–";
  return new Date(v).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ago(v: string | Date | null | undefined): string {
  if (!v) return "nie";
  const min = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (min < 2) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  if (min < 48 * 60) return `vor ${Math.round(min / 60)} Std.`;
  return `vor ${Math.round(min / 1440)} Tagen`;
}

export function AdminScreen({ onClose }: { onClose: () => void }) {
  const q = useQuery({ ...trpc.admin.overview.queryOptions(), refetchInterval: 30000 });
  const [code, setCode] = useState("");
  const [uses, setUses] = useState(1);
  const [reset, setReset] = useState<{ name: string; code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries(trpc.admin.pathFilter());

  const run = async (fn: () => Promise<{ ok: boolean; code?: string } | void>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r && !r.ok) setError(errorText(r.code ?? "?"));
      await refresh();
    } catch {
      setError(errorText("network"));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorLine text="Keine Berechtigung oder Server nicht erreichbar." />;
  const { status: s, invites, players } = q.data;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display text-2xl font-bold uppercase">Verwaltung</h1>
        <Button kind="secondary" onClick={onClose}>Zurück</Button>
      </div>
      <ErrorLine text={error} />

      <Card title="Systemzustand" right={s.problems.length ? <Badge tone="red">{s.problems.length} Probleme</Badge> : <Badge tone="green">in Ordnung</Badge>}>
        {s.problems.length > 0 && (
          <ul className="text-sm text-red-300 mb-2 list-disc pl-5">{s.problems.map((p) => <li key={p.key}>{p.text}</li>)}</ul>
        )}
        <StatTable rows={[
          ["Rückstau (> 2 Min.)", s.backlog.count ? `${s.backlog.count}, ältestes ${Math.round(s.backlog.oldestOverdueSec / 60)} Min.` : "keiner"],
          ["Fehlgeschlagene Ereignisse", String(s.failed.count)],
          ["Letzter Prüflauf", s.audit ? `${s.audit.ok ? "ok" : "FEHLER"}, ${when(s.audit.at)}` : "–"],
          ["Letzte Sicherung", s.backup ? `${when(s.backup.at)} (${Math.round(s.backup.ageHours)} Std.)` : "keine erfasst"],
          ["Letzte E-Mail", s.mail.lastSentAt ? when(s.mail.lastSentAt) : "–"],
          ["Letzter Mail-Fehler", s.mail.lastError ? when(s.mail.lastError.at) : "–"],
        ]} />
        {s.failed.lastError && <p className="text-xs text-slate-400 mt-2 break-words">Zuletzt: {s.failed.lastType} – {s.failed.lastError}</p>}
        {s.mail.lastError && <p className="text-xs text-slate-400 mt-1 break-words">Mail: {s.mail.lastError.message}</p>}
      </Card>

      <Card title="Einladungscodes">
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="flex-1 min-w-36">
            <label className="text-sm text-slate-300" htmlFor="tf-code">Code (leer = zufällig)</label>
            <input id="tf-code" className="w-full h-11 rounded-lg field px-3" value={code} autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <span className="text-sm text-slate-300 block">Nutzungen</span>
            <Stepper value={uses} onChange={(v) => setUses(Math.max(1, v))} />
          </div>
        </div>
        <Button
          className="w-full mb-3"
          disabled={busy}
          onClick={() => run(async () => {
            const r = await trpcClient.admin.createInvite.mutate({ code: code.trim() || undefined, maxUses: uses });
            if (r.ok) setCode("");
            return r;
          })}
        >Code anlegen</Button>
        <ul className="divide-y divide-navy-600/70">
          {invites.map((i) => (
            <li key={i.code} className="flex items-center gap-2 py-2">
              <div className="flex-1 min-w-0">
                <div className="font-mono font-bold break-all">{i.code}</div>
                <div className="text-xs text-slate-400">{i.uses} von {i.maxUses} genutzt · {when(i.createdAt)}</div>
              </div>
              {i.disabledAt ? <Badge>deaktiviert</Badge> : i.uses >= i.maxUses ? <Badge>verbraucht</Badge> : (
                <Button kind="ghost" disabled={busy} onClick={() => run(() => trpcClient.admin.disableInvite.mutate({ code: i.code }))}>Deaktivieren</Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <AdminInvites />

      <Card title={`Spieler (${players.length})`}>
        {reset && (
          <div className="rounded-xl bg-navy-950 border border-brass-400/50 p-3 mb-3">
            <div className="text-sm text-slate-300">Rücksetzcode für <strong>{reset.name}</strong> (einmalig, gültig bis {when(new Date(reset.expiresAt))}):</div>
            <div className="font-mono text-xl font-bold tracking-wider my-1 select-all">{reset.code}</div>
            <div className="text-xs text-slate-400">Der Code wird nur jetzt angezeigt. Auf dem Anmeldebildschirm unter „Passwort vergessen?“ eingeben.</div>
          </div>
        )}
        <ul className="divide-y divide-navy-600/70">
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <div className="flex-1 min-w-0 text-sm">
                <div className="font-bold">{p.name} {p.isAdmin && <Badge tone="brass">Admin</Badge>}</div>
                <div className="text-xs text-slate-400">
                  {p.baseName ?? "kein Hafen"} · seit {when(p.createdAt)} · aktiv {ago(p.lastSeenAt)}
                  {p.email ? ` · E-Mail ${p.emailVerified ? "bestätigt" : "unbestätigt"}` : ""}
                </div>
              </div>
              <Button
                kind="secondary"
                className="text-xs"
                disabled={busy}
                onClick={() => run(async () => {
                  const r = await trpcClient.admin.createResetCode.mutate({ playerId: p.id });
                  if (r.ok) setReset({ name: r.name, code: r.code, expiresAt: r.expiresAt });
                  return r;
                })}
              >Rücksetzcode</Button>
            </li>
          ))}
        </ul>
      </Card>

      <AdminMail />
    </div>
  );
}
