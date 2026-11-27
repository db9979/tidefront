// Verwaltung → Lagebild: Kartennebel an/aus (Server-Einstellung intel_fog, Vorgabe an). Aus = alle sehen alles wie bis
// 0.17 (Nest-Stufen, Schutzstatus, Wracks, Felder); Sensoren und gespeichertes Wissen laufen weiter.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { failText } from "../lib/names.ts";
import { Button, Card, ErrorLine } from "../ui.tsx";

export function AdminIntel() {
  const q = useQuery(trpc.admin.intelFog.queryOptions());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = q.data?.on ?? true;

  const save = async (value: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await trpcClient.admin.setIntelFog.mutate({ on: value });
      await queryClient.invalidateQueries(trpc.admin.intelFog.pathFilter());
      await queryClient.invalidateQueries(trpc.world.pathFilter());
      await queryClient.invalidateQueries(trpc.fields.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Lagebild" right={<span className="mono text-sm">{q.data ? (on ? "Nebel an" : "Nebel aus") : "…"}</span>}>
      <p className="text-xs text-ink2 mb-3">
        Kartennebel: Spieler sehen fremde Nest-Stufen, Schutzstatus, Wracks, Felder und Verbände nur mit Ausguck, Radar,
        Allianz oder Aufklärung. Hafen- und Nestpositionen bleiben immer sichtbar. Aus: alle sehen alles wie bis 0.17.
      </p>
      <div className="flex gap-2">
        <Button disabled={busy || !q.data || on} onClick={() => void save(true)}>Nebel an</Button>
        <Button kind="secondary" disabled={busy || !q.data || !on} onClick={() => void save(false)}>Nebel aus</Button>
      </div>
      {error && <ErrorLine text={error} />}
    </Card>
  );
}
