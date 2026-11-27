// Verwaltung: KI-Spieler – Server-Schalter und Obergrenze, Bots je Spielweise anlegen, Aktiv und „darf Menschen
// angreifen“ je Bot, letzte Aktionen, Entfernen (mit Rückfrage; räumt die Häfen über die normalen Befehle).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { Badge, Button, Card, ErrorLine, Stepper } from "../ui.tsx";
import { Switch } from "../components/Switch.tsx";

const WAIT_TEXT: Record<string, string> = {
  colonies: "Außenposten werden aufgegeben",
  missions_out: "Verbände unterwegs",
  incoming_own: "eigene Verlegung unterwegs",
  attack_incoming: "Angriff im Anmarsch",
  guests_stationed: "verbündete Gäste",
  blockaded: "Blockade",
  under_siege: "Belagerung",
  deliveries_underway: "Lieferungen unterwegs",
  offers_open: "Handelsangebote offen",
  field_held: "Rohstofffeld gehalten",
};

function time(ms: number | null): string {
  if (!ms) return "–";
  return new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function AdminBots() {
  const q = useQuery({ ...trpc.bots.list.queryOptions(), refetchInterval: 30000 });
  const [profile, setProfile] = useState<"haendler" | "festung" | "freibeuter">("haendler");
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!q.data) return null;
  const d = q.data;

  const run = async (fn: () => Promise<{ ok: boolean; code?: string } | void>, done?: string) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fn();
      if (r && !r.ok) setError(r.code ? errorText(r.code) : "Nicht möglich.");
      else if (done) setMsg(done);
      await queryClient.invalidateQueries(trpc.bots.pathFilter());
      await queryClient.invalidateQueries(trpc.admin.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`KI-Spieler (${d.bots.length})`} right={d.enabled ? <Badge tone="green">laufen</Badge> : <Badge tone="red">angehalten</Badge>}
      collapsible storageKey="admin-bots" defaultOpen={false}>
      <ErrorLine text={error} />
      {msg && <p className="text-sm text-green-300 mb-2">{msg}</p>}
      <Switch label="KI-Spieler ziehen (Server-Schalter)" on={d.enabled} disabled={busy}
        onChange={(v) => run(() => trpcClient.bots.server.mutate({ enabled: v }))} />
      <div className="flex items-center justify-between gap-3 my-2">
        <span className="text-sm text-slate-300">Höchstzahl der KI-Spieler</span>
        <Stepper value={d.max} onChange={(v) => run(() => trpcClient.bots.server.mutate({ max: Math.max(0, Math.min(50, v)) }))} />
      </div>
      <div className="flex flex-wrap items-center gap-2 my-3">
        <select className="rounded-lg bg-navy-950 border border-navy-600 px-2 py-2 text-sm" value={profile} aria-label="Spielweise"
          onChange={(e) => setProfile(e.target.value as typeof profile)}>
          {d.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Button disabled={busy || d.bots.length >= d.max} onClick={() => run(async () => {
          const r = await trpcClient.bots.add.mutate({ profile });
          return r;
        }, "Bot angelegt.")}>Bot hinzufügen</Button>
        {d.bots.length === 0 && (
          <Button kind="secondary" disabled={busy} onClick={() => run(() => trpcClient.bots.start.mutate(), "Startbesetzung angelegt.")}>
            Startbesetzung (je Spielweise einer)
          </Button>
        )}
      </div>
      <p className="text-[11px] text-slate-500 mb-2">
        Händler (leicht): Wirtschaft und Handel, greift nicht an. Festung (mittel): Verteidigung, Forschung, Nester. Freibeuter (stark):
        Überfälle mit Aufklärung und Probekampf, Minen, frühe Kolonien. Menschen greifen Bots nur an, wenn es hier erlaubt ist –
        mit allen Schutzregeln und einer Sperrfrist je Mensch.
      </p>
      <ul className="divide-y divide-navy-600/70">
        {d.bots.map((b) => (
          <li key={b.id} className="py-2">
            <button type="button" className="tap w-full text-left" onClick={() => setOpen(open === b.id ? null : b.id)}>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm flex-1 min-w-0 truncate">{b.name}</span>
                <Badge tone="sea">{b.profileName}</Badge>
                {b.removing ? <Badge tone="red">wird entfernt</Badge> : b.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">pausiert</Badge>}
                {b.errors > 0 && <Badge tone="red">{b.errors} Fehler</Badge>}
              </div>
              <div className="text-xs text-slate-400">
                {b.home ? `${b.home.name} · Feld ${b.home.col}/${b.home.row}` : "kein Hafen"}{b.bases > 1 ? ` (+${b.bases - 1})` : ""}
                {" · "}letzter Zug {time(b.lastTurnAtMs)}{b.lastTurnMs !== null ? ` (${b.lastTurnMs} ms)` : ""} · nächster {time(b.nextActAtMs)}
              </div>
            </button>
            {open === b.id && (
              <div className="mt-2 space-y-1">
                {!b.removing && (
                  <>
                    <Switch label="Aktiv" on={b.active} disabled={busy} onChange={(v) => run(() => trpcClient.bots.update.mutate({ id: b.id, active: v }))} />
                    <Switch label="Darf Menschen angreifen" on={b.attackHumans} disabled={busy}
                      onChange={(v) => run(() => trpcClient.bots.update.mutate({ id: b.id, attackHumans: v }))} />
                  </>
                )}
                <div className="text-xs text-slate-300 font-semibold mt-2">Letzte Aktionen</div>
                {b.log.length === 0 ? <p className="text-xs text-slate-500">Noch keine.</p> : (
                  <ul className="text-xs text-slate-400 space-y-0.5">
                    {b.log.map((l, i) => <li key={i}><span className="font-mono tabular-nums">{time(l.atMs)}</span> {l.text}</li>)}
                  </ul>
                )}
                <Button kind="secondary" className="text-xs mt-2" disabled={busy} onClick={() => {
                  if (!window.confirm(`${b.name} entfernen? Angebote werden zurückgezogen, Verbände zurückgerufen, Außenposten aufgegeben; danach werden Hafen und Spieler gelöscht.`)) return;
                  void run(async () => {
                    const r = await trpcClient.bots.remove.mutate({ id: b.id });
                    setMsg(r.removed ? `${b.name} entfernt.` : `Entfernen läuft – wartet auf: ${r.waiting.map((w) => WAIT_TEXT[w] ?? w).join(", ")}. Der Worker setzt es fort.`);
                    return { ok: true };
                  });
                }}>{b.removing ? "Entfernen erneut anstoßen" : "Entfernen …"}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
