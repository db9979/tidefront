// Verwaltung → Sicherungen: Liste, „Jetzt sichern“ und „Löschen“ (Aufträge an den Sicherungsdienst) und Herunterladen.
// Download: einmaliges Token (60 s) per tRPC holen, dann die Datei über /api/admin/backups/<name> laden.
// Wiederherstellen gibt es hier bewusst nicht (Konsole, siehe README).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "../lib/trpc.ts";
import { errorText, failText, fmtNum } from "../lib/names.ts";
import { Badge, Button, Card, ErrorLine } from "../ui.tsx";

function when(v: string | null | undefined): string {
  if (!v) return "–";
  return new Date(v).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${fmtNum(bytes / 1024 / 1024, 1)} MB`;
  return `${fmtNum(Math.max(1, Math.round(bytes / 1024)))} kB`;
}

const STATUS: Record<string, { text: string; tone: "slate" | "brass" | "green" | "red" | "sea" }> = {
  pending: { text: "wartet", tone: "brass" },
  running: { text: "läuft", tone: "sea" },
  done: { text: "fertig", tone: "green" },
  failed: { text: "fehlgeschlagen", tone: "red" },
};

export function AdminBackups() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    ...trpc.adminStats.backups.queryOptions(),
    // Solange ein Auftrag offen ist, alle 3 s nachsehen; sonst jede Minute.
    refetchInterval: (query) => (query.state.data?.requests.some((r) => r.status === "pending" || r.status === "running") || query.state.data?.deleting.length ? 3000 : 60000),
  });
  if (!q.data) return null;
  const { mounted, files, requests, deleting } = q.data;
  const last = requests[0];
  const open = last && (last.status === "pending" || last.status === "running");
  const waitedMin = last ? Math.floor((Date.now() - new Date(last.createdAt).getTime()) / 60000) : 0;

  const backupNow = async () => {
    setBusy("now");
    setError(null);
    try {
      const r = await trpcClient.adminStats.backupNow.mutate();
      if (!r.ok) setError(errorText(r.code));
      await queryClient.invalidateQueries(trpc.adminStats.backups.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(null);
    }
  };

  const download = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      const r = await trpcClient.adminStats.backupToken.mutate({ name });
      if (!r.ok) {
        setError(r.code === "no_file" ? "Die Sicherung ist nicht mehr vorhanden." : errorText(r.code));
        await q.refetch();
        return;
      }
      const a = document.createElement("a");
      a.href = `/api/admin/backups/${encodeURIComponent(name)}?t=${r.token}`;
      a.download = name;
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (name: string, at: string) => {
    if (!confirm(`Sicherung vom ${when(at)} endgültig löschen?\n${name}\n\nDas lässt sich nicht rückgängig machen.`)) return;
    setBusy(name);
    setError(null);
    try {
      const r = await trpcClient.adminStats.backupDelete.mutate({ name });
      if (!r.ok) setError(r.code === "no_file" ? "Die Sicherung ist nicht mehr vorhanden." : errorText(r.code));
      await queryClient.invalidateQueries(trpc.adminStats.backups.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Sicherungen" right={<Badge tone={mounted ? "slate" : "red"}>{mounted ? `${files.length} ${files.length === 1 ? "Datei" : "Dateien"}` : "nicht eingehängt"}</Badge>}>
      {!mounted && (
        <p className="text-sm text-ink2 mb-2">
          Das Sicherungsverzeichnis ist im api-Dienst nicht eingehängt (docker-compose.yml: <span className="mono">/backups:ro</span>).
        </p>
      )}
      <Button className="w-full mb-2" disabled={busy !== null || !!open} onClick={backupNow}>
        {open ? "Sicherung läuft …" : "Jetzt sichern"}
      </Button>
      {last && (
        <div className="text-sm mb-3 flex flex-wrap items-center gap-2" aria-live="polite">
          <Badge tone={STATUS[last.status]?.tone ?? "slate"}>{STATUS[last.status]?.text ?? last.status}</Badge>
          <span className="text-ink2">
            {last.status === "pending" && (waitedMin >= 3
              ? `Seit ${waitedMin} Min. kein Start – läuft der Dienst „backup“?`
              : "Der Sicherungsdienst übernimmt den Auftrag innerhalb einer Minute.")}
            {last.status === "running" && `gestartet ${when(last.startedAt)}`}
            {last.status === "done" && <>Auftrag von {last.requestedBy ?? "?"}: <span className="mono">{last.file}</span></>}
            {last.status === "failed" && (last.error ?? "unbekannter Fehler")}
          </span>
        </div>
      )}
      <ErrorLine text={error} />
      {mounted && files.length === 0 && <p className="text-sm text-ink2 italic font-serif">Noch keine Sicherung vorhanden.</p>}
      <ul className="divide-y divide-navy-600/70">
        {files.map((f) => (
          <li key={f.name} className="flex items-center gap-2 py-2">
            <div className="flex-1 min-w-0 text-sm">
              <div className="font-bold">{when(f.at)} {f.source === "manuell" ? <Badge tone="brass">manuell</Badge> : <Badge>täglich</Badge>}</div>
              <div className="text-xs text-ink2 mono break-all">{f.name} · {size(f.bytes)}</div>
            </div>
            {deleting.includes(f.name) ? (
              <span className="text-xs text-ink2 italic shrink-0">wird gelöscht …</span>
            ) : (
              <div className="flex gap-1.5 shrink-0">
                <Button kind="secondary" className="text-xs px-2.5 tracking-[0.06em]" disabled={busy !== null} onClick={() => download(f.name)}>
                  {busy === f.name ? "…" : "Laden"}
                </Button>
                <Button kind="danger" className="text-xs px-2.5 tracking-[0.06em]" disabled={busy !== null} onClick={() => remove(f.name, f.at)}>
                  Löschen
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink2 mt-2">Wiederherstellen nur über die Konsole des Servers (README, „Sicherung und Wiederherstellung“).</p>
    </Card>
  );
}
