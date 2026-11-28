// Verwaltung → Spieler (UX-0.43 B3): Spieler mit Rücksetzcode, Einladungscodes, Freunde einladen (Grenzen),
// Auffällige Paare. Daten aus admin.overview (gemeinsamer Cache mit der Übersicht).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { Badge, Button, Card, ErrorLine, Loading, Stepper } from "../ui.tsx";
import { AdminInvites } from "./AdminInvites.tsx";
import { AdminPvp } from "./AdminPvp.tsx"; // Spieler gegen Spieler: Auffällige Paare

export function when(v: string | Date | null | undefined): string {
  if (!v) return "–";
  return new Date(v).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ago(v: string | Date | null | undefined): string {
  if (!v) return "nie";
  const min = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (min < 2) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  if (min < 48 * 60) return `vor ${Math.round(min / 60)} h`;
  return `vor ${Math.round(min / 1440)} Tagen`;
}

export function AdminPlayers() {
  const q = useQuery({ ...trpc.admin.overview.queryOptions(), refetchInterval: 30000 });
  const [code, setCode] = useState("");
  const [uses, setUses] = useState(1);
  const [reset, setReset] = useState<{ name: string; code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Fehler erscheinen am auslösenden Abschnitt, nicht oben außer Sicht.
  const [where, setWhere] = useState<"invite" | "players" | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<{ ok: boolean; code?: string } | void>, at: "invite" | "players" = "invite") => {
    setBusy(true);
    setError(null);
    setWhere(at);
    try {
      const r = await fn();
      if (r && !r.ok) setError(r.code ? errorText(r.code) : "Nicht möglich (Code schon in diesem Zustand?).");
      await queryClient.invalidateQueries(trpc.admin.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorLine text="Keine Berechtigung oder Server nicht erreichbar." />;
  const { invites, players } = q.data;
  const f = filter.trim().toLowerCase();
  const shown = f ? players.filter((p) => p.name.toLowerCase().includes(f) || (p.baseName ?? "").toLowerCase().includes(f)) : players;

  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-x-4 lg:items-start">
      <Card title={`Spieler (${players.length})`}>
        <input type="search" className="w-full h-11 rounded-lg field px-3 mb-2" placeholder="Name oder Hafen suchen" aria-label="Spieler suchen"
          value={filter} onChange={(e) => setFilter(e.target.value)} />
        {where === "players" && <ErrorLine text={error} />}
        {reset && (
          <div className="rounded-xl bg-navy-950 border border-brass-400/50 p-3 mb-3" role="status">
            <div className="text-sm text-slate-300">Rücksetzcode für <strong>{reset.name}</strong> (einmalig, gültig bis {when(new Date(reset.expiresAt))}):</div>
            <div className="font-mono text-xl font-bold tracking-wider my-1 select-all break-all">{reset.code}</div>
            <div className="text-xs text-slate-400">Der Code wird nur jetzt angezeigt. Auf dem Anmeldebildschirm unter „Passwort vergessen?“ eingeben.</div>
          </div>
        )}
        <ul className="divide-y divide-navy-600/70">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <div className="flex-1 min-w-0 text-sm">
                <div className="font-bold break-words">{p.name} {p.isAdmin && <Badge tone="brass">Admin</Badge>}{p.botProfile && <Badge tone="sea">KI</Badge>}</div>
                <div className="text-xs text-slate-400">
                  {p.baseName ?? "kein Hafen"}{p.baseCount > 1 ? ` (+${p.baseCount - 1} weitere)` : ""} · seit {when(p.createdAt)} · aktiv {ago(p.lastSeenAt)}
                  {p.email ? ` · E-Mail ${p.emailVerified ? "bestätigt" : "unbestätigt"}` : ""}
                </div>
              </div>
              {!p.botProfile && <Button
                kind="secondary"
                className="text-xs whitespace-nowrap"
                disabled={busy}
                onClick={() => run(async () => {
                  const r = await trpcClient.admin.createResetCode.mutate({ playerId: p.id });
                  if (r.ok) setReset({ name: r.name, code: r.code, expiresAt: r.expiresAt });
                  return r;
                }, "players")}
              >Rücksetzcode</Button>}
            </li>
          ))}
          {shown.length === 0 && <li className="py-2 text-sm text-ink2">Niemand gefunden.</li>}
        </ul>
      </Card>

      <div className="min-w-0">
        <Card title="Einladungscodes">
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div className="flex-1 min-w-36">
              <label className="text-sm text-slate-300" htmlFor="tf-code">Code (leer = zufällig)</label>
              <input id="tf-code" className="w-full h-11 rounded-lg field px-3" maxLength={64} value={code} autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} />
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
          {where === "invite" && <ErrorLine text={error} />}
          <ul className="divide-y divide-navy-600/70">
            {invites.map((i) => (
              <li key={i.code} className="flex items-center gap-2 py-2">
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-bold break-all">{i.code}</div>
                  <div className="text-xs text-slate-400">{i.uses} von {i.maxUses} genutzt · {when(i.createdAt)}</div>
                </div>
                {i.disabledAt ? (
                  <>
                    <Badge>deaktiviert</Badge>
                    <Button kind="ghost" disabled={busy} onClick={() => run(() => trpcClient.admin.enableInvite.mutate({ code: i.code }))}>Aktivieren</Button>
                  </>
                ) : i.uses >= i.maxUses ? <Badge>verbraucht</Badge> : (
                  <Button
                    kind="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Code ${i.code} deaktivieren? Mit ihm kann sich dann niemand mehr registrieren (später wieder aktivierbar).`)) {
                        void run(() => trpcClient.admin.disableInvite.mutate({ code: i.code }));
                      }
                    }}
                  >Deaktivieren</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <AdminInvites />
        <AdminPvp />
      </div>
    </div>
  );
}
