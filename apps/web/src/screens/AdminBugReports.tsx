// Verwaltung: Fehlermeldungen der Spieler mit Screenshot, Log und Angaben; Status offen/erledigt; Empfängeradresse.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { Badge, Button, Card, ErrorLine } from "../ui.tsx";

function when(v: string | Date | null | undefined): string {
  if (!v) return "–";
  return new Date(v).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Detail({ id }: { id: number }) {
  const q = useQuery(trpc.bugReport.get.queryOptions({ id }));
  const [big, setBig] = useState(false);
  if (q.isLoading) return <p className="text-xs text-ink2 py-2">Lädt …</p>;
  const d = q.data;
  if (!d) return <ErrorLine text="Meldung nicht gefunden." />;
  return (
    <div className="mt-2 text-sm">
      <p className="whitespace-pre-wrap break-words mb-2">{d.text || <em className="text-ink2">ohne Beschreibung</em>}</p>
      {d.screenshot && (
        <button type="button" className="block w-full mb-2" onClick={() => setBig(!big)} aria-label="Screenshot vergrößern">
          <img src={d.screenshot} alt="Screenshot" className={`w-full border border-rule rounded object-contain ${big ? "" : "max-h-64"}`} />
        </button>
      )}
      {d.screenshot && <a className="text-xs text-see underline" href={d.screenshot} download={`fehlermeldung-${id}.jpg`}>Screenshot herunterladen</a>}
      <details className="mt-2">
        <summary className="cursor-pointer">Angaben</summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs mt-1">
          {Object.entries(d.meta).map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-ink2">{k}</dt><dd className="mono break-all">{String(v)}</dd></div>
          ))}
        </dl>
      </details>
      <details className="mt-2">
        <summary className="cursor-pointer">Log</summary>
        <pre className="text-[11px] mono whitespace-pre-wrap break-all max-h-72 overflow-y-auto mt-1 p-2 border border-rule rounded bg-paper">{d.log || "leer"}</pre>
      </details>
    </div>
  );
}

export function AdminBugReports() {
  const q = useQuery({ ...trpc.bugReport.list.queryOptions(), refetchInterval: 60000 });
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<"offen" | "alle">("offen");
  const [to, setTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data && to === null) setTo(q.data.recipientsSetting);
  }, [q.data, to]);
  if (!q.data) return null;
  const d = q.data;
  const list = d.reports.filter((r) => filter === "alle" || r.status === "offen");
  const openCount = d.reports.filter((r) => r.status === "offen").length;

  const run = async (fn: () => Promise<{ ok: boolean; code?: string }>, done?: string) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.code ? errorText(r.code) : "Nicht möglich.");
      else if (done) setMsg(done);
      await queryClient.invalidateQueries(trpc.bugReport.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Fehlermeldungen" right={openCount ? <Badge tone="red">{openCount} offen</Badge> : <Badge tone="green">nichts offen</Badge>}>
      <p className="text-xs text-ink2 mb-2">
        {d.mailReady
          ? d.recipients.length ? `Neue Meldungen gehen per E-Mail an ${d.recipients.join(", ")}.` : "Keine Empfängeradresse: Meldungen werden nur hier gespeichert."
          : "E-Mail-Versand ist nicht eingerichtet: Meldungen werden nur hier gespeichert."}
      </p>
      <div className="flex gap-2 mb-1">
        <input
          className="flex-1 min-w-0 h-11 rounded-lg field px-3"
          placeholder="Empfänger (leer = alle Admins)"
          aria-label="Empfänger der Fehlermeldungen"
          maxLength={1000}
          value={to ?? ""}
          onChange={(e) => setTo(e.target.value)}
        />
        <Button kind="secondary" disabled={busy} onClick={() => run(() => trpcClient.bugReport.setRecipients.mutate({ to: to ?? "" }), "Gespeichert.")}>Speichern</Button>
      </div>
      <p className="text-xs text-ink2 mb-3">Mehrere Adressen mit Komma trennen. Leer: alle Admins mit bestätigter E-Mail-Adresse.</p>
      {msg && <p className="text-sm text-moos">{msg}</p>}
      <ErrorLine text={error} />
      <div className="flex gap-3 text-sm mb-2">
        {(["offen", "alle"] as const).map((f) => (
          <button key={f} type="button" className={`tap ${filter === f ? "font-semibold underline underline-offset-4" : "text-ink2"}`} onClick={() => setFilter(f)}>
            {f === "offen" ? "Offene" : `Alle (${d.reports.length})`}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="text-sm text-ink2">Keine Meldungen.</p>}
      <ul className="divide-y divide-navy-600/70">
        {list.map((r) => (
          <li key={r.id} className="py-2">
            <div className="flex items-start gap-2">
              <button type="button" className="tap flex-1 min-w-0 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <div className="font-bold text-sm break-words">#{r.id} {r.subject}</div>
                <div className="text-xs text-ink2">
                  {r.playerName ?? "gelöschter Spieler"} · {when(r.createdAt)}{r.hasScreenshot ? " · Screenshot" : ""} · {r.mailedAt ? "gemailt" : "nicht gemailt"}
                </div>
              </button>
              <Badge tone={r.status === "offen" ? "red" : "green"}>{r.status}</Badge>
              <Button
                kind="ghost"
                className="text-xs px-1"
                disabled={busy}
                onClick={() => run(() => trpcClient.bugReport.setStatus.mutate({ id: r.id, status: r.status === "offen" ? "erledigt" : "offen" }))}
              >{r.status === "offen" ? "Erledigt" : "Wieder öffnen"}</Button>
            </div>
            {open === r.id && <Detail id={r.id} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}
