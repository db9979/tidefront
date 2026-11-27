// Verwaltung → Ereignisse: endgültig fehlgeschlagene Ereignisse der Queue (nach 5 Fehlversuchen) mit letztem
// Fehler; „Neu einreihen“ macht eines sofort wieder fällig (Spielzeit bleibt die ursprüngliche Fälligkeit).
// Der Wächter im Worker legt fehlende Folgeereignisse (Ketten, Missionen) ohnehin alle 10 Minuten neu an.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { failText } from "../lib/names.ts";
import { Badge, Button, Card, ErrorLine } from "../ui.tsx";

const CODE_TEXT: Record<string, string> = {
  not_failed: "Das Ereignis ist nicht mehr fehlgeschlagen.",
  already_pending: "Für dasselbe Objekt ist bereits ein Ereignis dieses Typs offen (z. B. vom Wächter neu angelegt).",
};

function when(ms: number | null): string {
  if (ms === null) return "–";
  return new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function AdminEvents() {
  const q = useQuery({ ...trpc.admin.failedEvents.queryOptions(), refetchInterval: 60000 });
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const requeue = async (id: number) => {
    setBusy(id);
    setError(null);
    try {
      const r = await trpcClient.admin.requeueEvent.mutate({ id });
      if (!r.ok) setError(CODE_TEXT[r.code] ?? r.code);
      await queryClient.invalidateQueries(trpc.admin.failedEvents.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(null);
    }
  };

  const total = q.data?.total ?? 0;
  return (
    <Card title="Fehlgeschlagene Ereignisse" right={<Badge tone={total > 0 ? "red" : "green"}>{total}</Badge>}>
      <p className="text-xs text-ink2 mb-3">
        Ereignisse, die fünfmal gescheitert sind. Der Wächter plant hängende Missionen und abgerissene Ketten
        (Kartell, Radarposten, Seekabel, Satelliten, Patrouillen) alle 10 Minuten selbst neu ein.
      </p>
      {total === 0 && <p className="text-sm">Keine fehlgeschlagenen Ereignisse.</p>}
      <ul className="flex flex-col gap-2" data-testid="admin-failed-events">
        {(q.data?.events ?? []).map((e) => (
          <li key={e.id} className="border border-rule rounded p-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="mono text-sm">#{e.id}</span>
              <span className="font-semibold text-sm">{e.type}</span>
              <span className="text-xs text-ink2">fällig {when(e.origDueAtMs ?? e.dueAtMs)}</span>
              <span className="text-xs text-ink2">{e.attempts} Versuche</span>
              <span className="flex-1" />
              <Button kind="secondary" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Weniger" : "Details"}</Button>
              <Button disabled={busy !== null} onClick={() => requeue(e.id)}>Neu einreihen</Button>
            </div>
            {open === e.id && (
              <pre className="mono text-[11px] whitespace-pre-wrap break-all mt-2 text-ink2">
                {JSON.stringify(e.payload)}
                {e.baseId !== null ? ` · Hafen ${e.baseId}` : ""}
                {"\n"}
                {e.lastError ?? "kein Fehlertext"}
              </pre>
            )}
          </li>
        ))}
      </ul>
      {total > (q.data?.events.length ?? 0) && <p className="text-xs text-ink2 mt-2">Gezeigt: die neuesten {q.data?.events.length}.</p>}
      {error && <ErrorLine text={error} />}
    </Card>
  );
}
