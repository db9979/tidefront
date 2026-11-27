// Meldungen → Lagebild (Stufe 2, Regelwerk 8): fremde Patrouillen (gemeldet und gesichtet), letzte Sichtungen mit Stand,
// eigene Sensoren (Häfen, Radarposten, Patrouillen, Verbände) mit Reichweite und die eigenen Radarposten (abbauen).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import type { Target } from "../App.tsx";
import { Icon } from "../icons.tsx";
import { Badge, Card, ErrorLine, Loading, SmallButton, UnitChips } from "../ui.tsx";

const SENSOR_TEXT: Record<string, string> = {
  ausguck: "Ausguck", radar: "Radar", posten: "Radarposten", patrouille: "Patrouille", aufklaerer: "Aufklärer", verband: "Bordsicht", flug: "Flugzeuge (Sichtung)", sonar: "Sonar",
};
const LEVEL_TEXT: Record<string, string> = { sichtung: "Sichtung", erkennung: "Erkennung", lagebild: "Lagebild" };

function ago(ms: number, now: number): string {
  const min = Math.max(0, Math.round((now - ms) / 60000));
  return min < 60 ? `vor ${min} min` : `vor ${Math.round(min / 60)} h`;
}

export function LagebildTab({ onShowOnMap }: { onShowOnMap: (t: Target) => void }) {
  const q = useQuery({ ...trpc.intel.overview.queryOptions(), refetchInterval: 60000 });
  const [confirm, setConfirm] = useState<number | null>(null);
  const dismantle = useCommand((i: { key: string; postId: number }) => trpcClient.intel.dismantlePost.mutate(i), () => [trpc.intel.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.world.map.pathFilter().queryKey]);
  if (!q.data) return <Loading />;
  const d = q.data;
  if (!d.enabled) return <Card title="Lagebild"><p className="text-sm">Auf diesem Server gibt es keinen Kartennebel: Du siehst die ganze Welt.</p></Card>;
  const now = d.serverNow;
  const here = (col: number | null, row: number | null) => col !== null && row !== null
    ? <SmallButton onClick={() => onShowOnMap({ col, row })}>Karte</SmallButton> : null;
  const sensors = Object.entries(d.sensors.reduce<Record<string, { n: number; km: number }>>((acc, s) => {
    const k = s.kind;
    acc[k] = { n: (acc[k]?.n ?? 0) + 1, km: Math.max(acc[k]?.km ?? 0, s.km) };
    return acc;
  }, {}));

  return (
    <div className="space-y-3" data-testid="lagebild-tab">
      {!d.fog && <p className="text-xs text-ink2">Der Kartennebel ist auf diesem Server aus; Sensoren laufen trotzdem.</p>}

      <Card title={<><Icon id="patrouille" size={18} /> Fremde Patrouillen</>}>
        {d.reported.length === 0 && d.patrols.length === 0 ? <p className="text-sm text-ink2">Keine fremden Patrouillen oder Aufklärer in den letzten 24 Stunden.</p> : (
          <ul className="divide-y divide-rule">
            {d.reported.map((r) => (
              <li key={`r${r.id}`} className="py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0"><div className="font-semibold leading-tight">{r.title}</div><div className="text-xs text-ink2">{r.owner} · {ago(r.atMs, now)}</div></div>
                {here(r.col, r.row)}
              </li>
            ))}
            {d.patrols.map((s) => (
              <li key={`p${s.id}`} className="py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0"><div className="leading-tight">{s.name}</div><div className="text-xs text-ink2">{s.source} · {ago(s.atMs, now)}</div></div>
                {here(s.col, s.row)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Letzte Sichtungen" collapsible storageKey="lagebild-sichtungen">
        {d.sightings.length === 0 ? <p className="text-sm text-ink2">Noch keine Sichtungen. Patrouillen, Kampagnen und jeder Verband auf See klären unterwegs auf.</p> : (
          <ul className="divide-y divide-rule">
            {d.sightings.slice(0, 25).map((s) => (
              <li key={`${s.kind}${s.id}`} className="py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="leading-tight truncate">{s.name}</div>
                  <div className="text-xs text-ink2 truncate">{LEVEL_TEXT[s.level] ?? s.level} · {s.source} · {s.age === "live" ? "jetzt" : ago(s.atMs, now)}{s.age === "veraltet" ? " (veraltet)" : ""}</div>
                </div>
                {here(s.col, s.row)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Eigene Sensoren">
        <ul className="text-sm space-y-1">
          {sensors.map(([kind, v]) => (
            <li key={kind} className="flex justify-between gap-2"><span>{SENSOR_TEXT[kind] ?? kind}{v.n > 1 ? ` × ${v.n}` : ""}</span><span className="mono text-ink2">bis {fmtNum(v.km)} km</span></li>
          ))}
        </ul>
        <p className="text-xs text-ink2 mt-2">Die gestrichelten Kreise auf der Karte zeigen jeden Sensor (Knopf „Sensoren“).</p>
      </Card>

      <Card title={<><Icon id="radarposten" size={18} /> Radarposten ({d.posts.length})</>}>
        {d.posts.length === 0 ? <p className="text-sm text-ink2">Keine Radarposten. Errichten über „Mission planen“ → Radarposten (5 Pioniere und ein Landungsschiff, Radarstation 3).</p> : (
          <ul className="divide-y divide-rule">
            {d.posts.map((p) => (
              <li key={p.id} className="py-2" data-post={p.id}>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold leading-tight">Feld {p.col}/{p.row} {p.offline ? <Badge tone="red">ohne Treibstoff</Badge> : <Badge tone="green">in Betrieb</Badge>}</div>
                    <div className="text-xs text-ink2">{fmtNum(p.rangeKm)} km · versorgt von {p.baseName} · {fmtNum(d.rules.post?.fuelPerHour ?? 3)} {label("treibstoff")}/h</div>
                  </div>
                  {here(p.col, p.row)}
                </div>
                <div className="text-xs mt-1"><UnitChips counts={p.crew} /></div>
                <div className="flex justify-end gap-1 mt-1">
                  {confirm === p.id ? (
                    <>
                      <SmallButton onClick={() => setConfirm(null)}>Behalten</SmallButton>
                      <SmallButton onClick={async () => { const r = await dismantle.run({ postId: p.id }); if (r?.ok) { setConfirm(null); void queryClient.invalidateQueries(trpc.intel.pathFilter()); } }}>Ja, abbauen ({Math.round((d.rules.post?.refund ?? 0.5) * 100)} % zurück)</SmallButton>
                    </>
                  ) : <SmallButton onClick={() => setConfirm(p.id)}>Abbauen</SmallButton>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <ErrorLine text={dismantle.error} code={dismantle.code} />
        <p className="text-xs text-ink2 mt-2">Stand {fmtTime(now)}.</p>
      </Card>
    </div>
  );
}
