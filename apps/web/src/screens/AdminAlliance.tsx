// Verwaltung → Allianzen (v1.35, Nutzerentscheid 6B): Höchstgröße je Allianz. Ohne Einstellung rechnet der Server
// max(3, ⌈Menschen / 2⌉); hier lässt sie sich fest setzen (2–50). Bestehende größere Allianzen nehmen niemanden mehr auf.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { failText } from "../lib/names.ts";
import { Button, Card, ErrorLine } from "../ui.tsx";

export function AdminAlliance() {
  const q = useQuery(trpc.alliance.get.queryOptions());
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (q.data) setSize(String(q.data.maxSize)); }, [q.data?.maxSize]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = Number(size);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await trpcClient.alliance.setMaxSize.mutate({ size: n });
      await queryClient.invalidateQueries(trpc.alliance.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Allianzen" collapsible storageKey="admin-alliance" defaultOpen={false}>
      <div className="flex items-center gap-2">
        <label className="text-sm text-ink2 flex-1" htmlFor="admin-alliance-max">Höchstgröße je Allianz</label>
        <input id="admin-alliance-max" inputMode="numeric" className="w-20 h-11 rounded-lg field text-center mono" value={size}
          onChange={(e) => setSize(e.target.value.replace(/\D/g, ""))} />
        <Button kind="secondary" disabled={busy || !(n >= 2 && n <= 50)} onClick={() => void save()}>Setzen</Button>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        Ohne eigene Einstellung gilt max(3, ⌈Menschen ÷ 2⌉). Der Allianzrang ist der Durchschnitt der Mitgliederpunkte (geteilt durch
        mindestens 2), damit Größe allein nicht gewinnt.
      </p>
      <ErrorLine text={error} />
    </Card>
  );
}
