// Zeitgesteuerte Zustandswechsel (Bau/Ausbildung/Forschung fertig, Mission angekommen oder zurück, Angriff trifft
// ein, Lieferung da, Nachtschild an/aus): Kurz nach dem Zeitpunkt die Hafenansicht neu holen, falls bis dahin keine
// Live-Meldung kam. Ein einziger Zeitgeber für den nächsten fälligen Zeitpunkt, je Zeitpunkt zwei Versuche;
// danach übernimmt wieder der normale Abruf.
import { useEffect, useState } from "react";
import { queryClient, trpc, type BaseData } from "./trpc.ts";
import { serverNow } from "./time.ts";
import { dueTimes, nextRefresh } from "./due-times.ts";

export function useDueRefresh(base: BaseData | null): void {
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!base) return;
    const at = nextRefresh(dueTimes(base), serverNow());
    if (at === null) return;
    const t = setTimeout(() => {
      for (const f of [trpc.base.pathFilter(), trpc.report.pathFilter()]) void queryClient.invalidateQueries(f);
      setRound((n) => n + 1); // nächsten Zeitpunkt planen, auch wenn die Antwort gleich bleibt
    }, Math.min(2_147_000_000, at - serverNow()));
    return () => clearTimeout(t);
  }, [base, round]);
}
