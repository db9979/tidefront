// Truppen → Einsatz: Patrouille auf Station – Restzeit, Wegpunkte, Sicht, Abschüsse und „Heimholen“ (Lagebild Stufe 2).
import { trpc, trpcClient, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, nOf } from "../lib/names.ts";
import { fmtDuration } from "../lib/time.ts";
import { ErrorLine, SmallButton } from "../ui.tsx";

export function PatrolLine({ m, now }: { m: BaseData["missions"][number]; now: number }) {
  const end = useCommand((i: { key: string; missionId: number }) => trpcClient.intel.endPatrol.mutate(i), () => [trpc.base.pathFilter().queryKey, trpc.world.map.pathFilter().queryKey]);
  const p = m.patrol;
  if (!p) return null;
  return (
    <div className="text-sm mt-1" data-patrol={m.id}>
      <div className="text-sea-300">Patrouille über {p.waypoints.length} Wegpunkte · noch {fmtDuration(Math.max(0, (p.endMs ?? now) - now))}</div>
      <div className="text-xs text-ink2">Sicht {fmtNum(p.sightKm)} km{p.shot > 0 ? ` · ${nOf(p.shot, "Drohne", "Drohnen")} abgeschossen` : ""}</div>
      <div className="flex justify-end mt-1"><SmallButton disabled={end.busy} onClick={() => void end.run({ missionId: m.id })}>Heimholen</SmallButton></div>
      <ErrorLine text={end.error} code={end.code} />
    </div>
  );
}
