// Verwaltung → Weltpolitik (docs/REGELN-WELTPOLITIK.md, Abschnitt 1). Zwei Teile (UX-0.43 B3):
// mode "danger" (Welt → Gefahrenzone): Not-Aus je Baustein (Gezeit, Seerat, Gesuche) und Fenster absagen (Ruhige See,
// der Seerat überschreibt es nicht mehr), jeweils mit Bestätigung. mode "stats" (Statistik): was jetzt wirkt, Fenster der
// Saison, Seerat-Sitzungen mit Zwischenstand und Zähler der Gesuche – nur lesend.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { fmtRange, useNow } from "../lib/time.ts";
import { Badge, Button, Card, ErrorLine } from "../ui.tsx";

const PARTS = [
  { id: "gezeit", label: "Gezeit (Plan-Fenster wirken nicht)" },
  { id: "seerat", label: "Seerat (neue Sitzungen ausgesetzt, keine Stimmen)" },
  { id: "gesuche", label: "Gesuche (keine neuen Angebote)" },
] as const;

export function AdminPolitik({ mode }: { mode: "danger" | "stats" }) {
  const q = useQuery({ ...trpc.politik.admin.queryOptions(), refetchInterval: 30000 });
  const now = useNow(60000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; code?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(errorText(r.code ?? "?"));
      await queryClient.invalidateQueries(trpc.politik.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };
  const d = q.data;
  if (mode === "danger") {
    const cancellable = (d?.windows ?? []).filter((w) => w.endMs > now && w.effect !== "ruhig");
    return (
      <Card title="Weltpolitik: Not-Aus">
        {!d ? <p className="text-sm text-ink2">Lädt …</p> : <>
          <ul className="mb-3" aria-label="Not-Aus">
            {PARTS.map((p) => {
              const off = d.off[p.id];
              return (
                <li key={p.id} className="dotted-row py-1.5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1 min-w-40">{p.label}</span>
                  <Badge tone={off ? "red" : "green"}>{off ? "aus" : "an"}</Badge>
                  <Button kind={off ? "secondary" : "danger"} className="whitespace-nowrap" disabled={busy} onClick={() => {
                    if (confirm(off ? `${p.label.split(" ")[0]} wieder einschalten?` : `${p.label.split(" ")[0]} für alle Spieler ausschalten?`)) void run(() => trpcClient.politik.adminOff.mutate({ part: p.id, off: !off }));
                  }}>
                    {off ? "Einschalten" : "Ausschalten"}
                  </Button>
                </li>
              );
            })}
          </ul>
          <h3 className="font-display uppercase text-[11px] text-ink2 mb-1">Kommende Fenster absagen</h3>
          {cancellable.length === 0 ? <p className="text-xs text-ink2">Kein absagbares Fenster.</p> : (
            <ul data-testid="admin-politik-cancel">
              {cancellable.map((w) => (
                <li key={w.id} className="dotted-row py-1.5 flex items-center gap-2 text-xs flex-wrap">
                  <span className="mono">{fmtRange(w.startMs, w.endMs, now)}</span>
                  <span className="flex-1 min-w-0">{w.name}</span>
                  <Button kind="ghost" disabled={busy} onClick={() => { if (confirm(`${w.name} absagen?`)) void run(() => trpcClient.politik.adminCancel.mutate({ fensterId: w.id })); }}>Absagen</Button>
                </li>
              ))}
            </ul>
          )}
        </>}
        <ErrorLine text={error} />
      </Card>
    );
  }
  return (
    <Card title="Weltpolitik" collapsible storageKey="admin-politik" defaultOpen={false} summary={d ? (d.lines.length ? d.lines.map((l) => l.text).join(" · ") : "Fenster, Seerat, Gesuche") : "Lädt …"}>
      {!d ? <p className="text-sm text-ink2">Lädt …</p> : <>
        <p className="text-xs mb-2">Not-Aus: {PARTS.map((p) => `${p.label.split(" ")[0]} ${d.off[p.id] ? "aus" : "an"}`).join(" · ")} (schalten unter Welt → Gefahrenzone)</p>
        {d.lines.length > 0 && <p className="text-xs mb-2">Wirkt jetzt: {d.lines.map((l) => l.text).join(" · ")}</p>}
        <h3 className="font-display uppercase text-[11px] text-ink2 mb-1">Fenster der Saison</h3>
        <ul className="mb-3" data-testid="admin-politik-windows">
          {d.windows.map((w) => (
            <li key={w.id} className="dotted-row py-1.5 flex items-center gap-2 text-xs flex-wrap">
              <span className="mono">{fmtRange(w.startMs, w.endMs, now)}</span>
              <span className="flex-1 min-w-0">{w.slot === "gezeit" ? `Gezeit ${w.idx}` : `Woche ${w.idx}`}: {w.name}{w.planName && w.planName !== w.name ? ` (Plan: ${w.planName})` : ""} · {w.source}</span>
              {w.active && <Badge tone="green">jetzt</Badge>}
            </li>
          ))}
        </ul>
        <h3 className="font-display uppercase text-[11px] text-ink2 mb-1">Seerat</h3>
        <ul className="mb-2 text-xs">
          {d.sessions.map((s) => {
            const t = s.tally as { voted?: number; quorum?: number; winner?: string } | null;
            return (
              <li key={s.id} className="dotted-row py-1">
                {s.kind === "fenster" ? "Fenster" : "Woche"} · {fmtRange(s.opensMs, s.closesMs, now)} · {s.status}
                {t ? ` · ${t.voted ?? 0}/${t.quorum ?? 0} Stimmen · ${s.result ?? t.winner ?? ""}` : ""}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-ink2">Gesuche der Saison: {Object.entries(d.gesuche).map(([k, n]) => `${k} ${n}`).join(", ") || "keine"}</p>
      </>}
    </Card>
  );
}
