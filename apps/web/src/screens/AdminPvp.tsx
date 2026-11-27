// Verwaltung → Auffällige Paare (Spieler gegen Spieler): Paare mit vielen Kämpfen in wenigen Tagen oder mit Siegen
// ohne Verluste des Verteidigers. Einzelne Berichte lassen sich aus der Wertung nehmen (und wieder aufnehmen);
// Rohstoffe und Verluste bleiben, nur die Punkte beider Seiten entfallen.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { errorText, failText, fmtNum } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { Card, ErrorLine, SmallButton } from "../ui.tsx";

export function AdminPvp() {
  const q = useQuery(trpc.admin.pvpPairs.queryOptions());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (reportId: number, excluded: boolean) => {
    setBusy(reportId);
    setError(null);
    try {
      const r = await trpcClient.admin.pvpExclude.mutate({ reportId, excluded });
      if (r && "ok" in r && !r.ok) setError(errorText(r.code));
      await queryClient.invalidateQueries(trpc.admin.pvpPairs.pathFilter());
      await queryClient.invalidateQueries(trpc.social.pathFilter());
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(null);
    }
  };

  const pairs = q.data?.pairs ?? [];
  return (
    <Card title="Auffällige Paare" right={<span className="mono text-sm">{q.data ? fmtNum(pairs.length) : "…"}</span>}>
      <p className="text-xs text-ink2 mb-2">
        Spielerpaare mit mindestens {q.data?.minFights ?? 3} Kämpfen in {q.data?.days ?? 7} Tagen oder mit Siegen, bei denen der
        Verteidiger nichts verlor (Verdacht auf Punkteschieben). „Aus der Wertung nehmen“ streicht Kampf- und Beutepunkte
        beider Seiten aus diesem Bericht; Rohstoffe und Verluste bleiben.
      </p>
      {q.data && pairs.length === 0 && <p className="text-sm text-ink2">Keine auffälligen Paare.</p>}
      <ul className="space-y-3">
        {pairs.map((p) => (
          <li key={`${p.a}:${p.b}`}>
            <div className="text-sm font-semibold">{p.aName} ↔ {p.bName}</div>
            <div className="text-xs text-ink2">{fmtNum(p.fights)} {p.fights === 1 ? "Kampf" : "Kämpfe"}{p.cleanWins > 0 ? ` · ${fmtNum(p.cleanWins)} ${p.cleanWins === 1 ? "Sieg" : "Siege"} ohne Verteidigungsverluste` : ""}</div>
            <ul className="mt-1 divide-y divide-navy-700">
              {p.reports.map((r) => (
                <li key={r.id} className="py-1 flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1">
                    <span className="mono text-ink2">{fmtTime(r.atMs)}</span> {r.title}
                    {r.clean && <span className="text-siegel"> · ohne Verluste</span>}
                    {r.excluded && <span className="text-messing"> · aus der Wertung</span>}
                  </span>
                  <SmallButton disabled={busy === r.id} onClick={() => void toggle(r.id, !r.excluded)}>
                    {r.excluded ? "Wieder werten" : "Bericht aus der Wertung nehmen"}
                  </SmallButton>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {error && <ErrorLine text={error} />}
    </Card>
  );
}
