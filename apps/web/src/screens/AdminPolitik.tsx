// Verwaltung → Weltpolitik (docs/REGELN-WELTPOLITIK.md, Abschnitt 1): Not-Aus je Baustein (Gezeit, Seerat, Gesuche),
// Fenster absagen (Ruhige See, der Seerat überschreibt es nicht mehr), Sitzungen mit Zwischenstand, Zähler der Gesuche.
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

export function AdminPolitik() {
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
  return (
    <Card title="Weltpolitik" collapsible storageKey="admin-politik" defaultOpen={false} summary="Not-Aus, Fenster absagen, Seerat">
      {!d ? <p className="text-sm text-ink2">Lädt …</p> : <>
        <ul className="mb-3" aria-label="Not-Aus">
          {PARTS.map((p) => {
            const off = d.off[p.id];
            return (
              <li key={p.id} className="dotted-row py-1.5 flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0">{p.label}</span>
                <Badge tone={off ? "red" : "green"}>{off ? "aus" : "an"}</Badge>
                <Button kind="secondary" disabled={busy} onClick={() => void run(() => trpcClient.politik.adminOff.mutate({ part: p.id, off: !off }))}>
                  {off ? "Einschalten" : "Ausschalten"}
                </Button>
              </li>
            );
          })}
        </ul>
        {d.lines.length > 0 && <p className="text-xs mb-2">Wirkt jetzt: {d.lines.map((l) => l.text).join(" · ")}</p>}
        <h3 className="font-display uppercase text-[11px] text-ink2 mb-1">Fenster der Saison</h3>
        <ul className="mb-3" data-testid="admin-politik-windows">
          {d.windows.map((w) => (
            <li key={w.id} className="dotted-row py-1.5 flex items-center gap-2 text-xs flex-wrap">
              <span className="mono">{fmtRange(w.startMs, w.endMs, now)}</span>
              <span className="flex-1 min-w-0">{w.slot === "gezeit" ? `Gezeit ${w.idx}` : `Woche ${w.idx}`}: {w.name}{w.planName && w.planName !== w.name ? ` (Plan: ${w.planName})` : ""} · {w.source}</span>
              {w.active && <Badge tone="green">jetzt</Badge>}
              {w.endMs > now && w.effect !== "ruhig" && (
                <Button kind="ghost" disabled={busy} onClick={() => { if (confirm(`${w.name} absagen?`)) void run(() => trpcClient.politik.adminCancel.mutate({ fensterId: w.id })); }}>Absagen</Button>
              )}
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
      <ErrorLine text={error} />
    </Card>
  );
}
