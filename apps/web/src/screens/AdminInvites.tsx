// Verwaltung: Freunde einladen – Grenzen je Spieler, Abschalten für Nicht-Admins, alle Einladungen mit Einladendem.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { failText } from "../lib/names.ts";
import { Badge, Button, Card, ErrorLine, Stepper } from "../ui.tsx";
import { Switch } from "../components/Switch.tsx";

const STATUS: Record<string, { text: string; tone: "green" | "sea" | "brass" | "slate" | "red" }> = {
  accepted: { text: "angenommen", tone: "green" },
  sent: { text: "versandt", tone: "sea" },
  open: { text: "Link offen", tone: "brass" },
  expired: { text: "abgelaufen", tone: "slate" },
  revoked: { text: "zurückgezogen", tone: "red" },
};

function day(ms: number): string {
  return new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export function AdminInvites() {
  const q = useQuery(trpc.invite.admin.list.queryOptions());
  const [s, setS] = useState<{ enabled: boolean; maxOpen: number; maxWeek: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (q.data && !s) setS(q.data.settings);
  }, [q.data, s]);
  if (!q.data || !s) return null;
  const rows = all ? q.data.invites : q.data.invites.slice(0, 15);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await trpcClient.invite.admin.save.mutate(s);
      setS(r.settings);
      setMsg("Gespeichert.");
      await queryClient.invalidateQueries(trpc.invite.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Freunde einladen" right={s.enabled ? <Badge tone="green">an</Badge> : <Badge tone="red">nur Admins</Badge>}>
      <Switch label="Spieler dürfen Freunde einladen" on={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} disabled={busy} />
      <div className="flex flex-wrap gap-4 my-2">
        <div>
          <span className="text-sm text-slate-300 block">Offen je Spieler</span>
          <Stepper value={s.maxOpen} onChange={(v) => setS({ ...s, maxOpen: Math.max(1, Math.min(100, v)) })} />
        </div>
        <div>
          <span className="text-sm text-slate-300 block">Neue je Woche</span>
          <Stepper value={s.maxWeek} onChange={(v) => setS({ ...s, maxWeek: Math.max(1, Math.min(500, v)) })} />
        </div>
      </div>
      <Button className="w-full mb-2" disabled={busy} onClick={() => void save()}>Speichern</Button>
      {msg && <p className="text-sm text-emerald-300">{msg}</p>}
      <ErrorLine text={error} />
      <p className="text-xs text-slate-400 mb-2">
        Persönliche Einladungen gelten einmal und 14 Tage. Dieselbe Adresse höchstens einmal je 7 Tage; Adressen von Spielern
        und gesperrte Adressen werden abgelehnt.
      </p>
      {q.data.invites.length === 0 ? <p className="text-sm text-slate-400">Noch keine Einladungen.</p> : (
        <ul className="divide-y divide-navy-600/70">
          {rows.map((i) => (
            <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate"><strong>{i.inviterName}</strong> → {i.friendName ?? i.email ?? "Link"}{i.friendName && i.email ? ` (${i.email})` : ""}</div>
                <div className="text-xs text-slate-400">
                  {i.channel === "email" ? `E-Mail${i.sendCount > 1 ? ` (${i.sendCount}×)` : ""}` : "Link"} · {day(i.createdAtMs)} · bis {day(i.expiresAtMs)}
                  {i.acceptedName ? ` · angenommen von ${i.acceptedName}` : ""}
                  {" · "}<span className="mono">{i.code}</span>
                </div>
              </div>
              <Badge tone={STATUS[i.status]?.tone ?? "slate"}>{STATUS[i.status]?.text ?? i.status}</Badge>
            </li>
          ))}
        </ul>
      )}
      {!all && q.data.invites.length > rows.length && (
        <Button kind="ghost" className="w-full" onClick={() => setAll(true)}>Alle {q.data.invites.length} zeigen</Button>
      )}
    </Card>
  );
}
