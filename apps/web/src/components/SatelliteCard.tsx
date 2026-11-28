// Karte → Sichtungen (Stufe 3): eigene Satelliten mit nächstem Überflug („nächster Überflug in 2 h 10 min über …“),
// live laufendem Streifen und letzter Zusammenfassung; Start an den eigenen Startrampen (optisch oder Radar).
// Steht im Lagebild unten und ist eingeklappt, solange es weder Satellit noch Startrampe gibt; zugeklappt nennt die
// Kopfzeile die Voraussetzung der Startrampe (aus der Balance gelesen).
import { useQuery } from "@tanstack/react-query";
import { hexAtXY, ROWS, HEX_SIZE_KM } from "@tidefront/world";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { errorText, fmtNum, label, nOf } from "../lib/names.ts";
import { fmtDuration, fmtTime, useNow } from "../lib/time.ts";
import type { Target } from "../App.tsx";
import { Icon } from "../icons.tsx";
import { Badge, Card, Cost, ErrorLine, SmallButton } from "../ui.tsx";
import { ReasonLine } from "./Remedy.tsx";
import { useNav } from "../lib/nav.ts";

interface Strip { x0: number; x1: number; where: string }
export interface SatView {
  id: number; type: string; name: string; own: boolean; baseName: string; expiresAtMs: number; passes: number; passesDone: number;
  live: (Strip & { untilMs: number }) | null;
  next: (Strip & { atMs: number }) | null;
  last: { atMs: number; seen: number; clouded: number; nests: number; bases: number; fleets: number } | null;
}
export interface SatLaunch {
  pads: { baseId: number; baseName: string; padLevel: number; types: { type: string; name: string; cost: Record<string, number>; code: string | null }[] }[];
  active: number;
  limit: number;
  techs: { optisch: number; radar: number };
  rules: { lifetimeHours: number; lifetimeByType?: Record<string, number>; periodHours: number; stripKm: number; shiftKm: number; liveMinutes: number; max: number; maxMore: number; cloudMax: number | null };
}

/** Kartenziel in der Mitte eines Streifens. */
function stripTarget(s: Strip): Target {
  const h = hexAtXY((s.x0 + s.x1) / 2, (ROWS / 2) * 1.5 * HEX_SIZE_KM);
  return { col: h.col, row: h.row };
}

export function SatelliteCard({ sats, launch, onShowOnMap }: { sats: SatView[]; launch: SatLaunch | null; onShowOnMap: (t: Target) => void }) {
  const now = useNow();
  const start = useCommand(
    (i: { key: string; type: "optisch" | "radar"; baseId: number }) => trpcClient.intel.launchSatellite.mutate(i),
    () => [trpc.intel.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.world.map.pathFilter().queryKey],
  );
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const nav = useNav();
  if (!launch) return null;
  const r = launch.rules;
  const reqs = Object.entries(meta.data?.balance.buildings.startrampe?.requires ?? {}) as [string, number][];
  const requires = reqs.map(([id, l]) => `${label(id)} ${l}`).join(", ");
  // TST-11: nur nennen, was im aktiven Hafen noch fehlt; alles erfüllt → „Startrampe bauen“ mit Sprung zum Gebäude.
  const lvl = (id: string) => nav.base?.buildings.find((b) => b.id === id)?.level ?? 0;
  const missing = reqs.filter(([id, l]) => lvl(id) < l).map(([id, l]) => `${label(id)} ${l}`).join(", ");
  const ready = !!nav.base && reqs.length > 0 && missing === "";
  const nextPass = sats.map((s) => s.next?.atMs).filter((t): t is number => !!t).sort((a, b) => a - b)[0];
  const summary = sats.length > 0
    ? `${fmtNum(sats.length)} im Orbit${sats.some((s) => s.live) ? " · Überflug läuft" : nextPass ? ` · nächster Überflug in ${fmtDuration(nextPass - now)}` : ""}`
    : launch.pads.length > 0 ? "Startrampe bereit" : ready ? "Startrampe bauen (Voraussetzungen erfüllt)" : `Startrampe braucht noch ${missing || requires || "weitere Gebäude"}`;
  return (
    <Card title={<><Icon id="satellit" size={18} /> Satelliten ({sats.filter((s) => s.own).length}/{launch.limit})</>}
      collapsible storageKey="lagebild-satelliten" defaultOpen={sats.length > 0 || launch.pads.length > 0} summary={summary}>
      {sats.length === 0 ? (
        <p className="text-sm text-ink2">Kein Satellit in der Umlaufbahn.</p>
      ) : (
        <ul className="divide-y divide-rule" data-testid="satellites">
          {sats.map((s) => (
            <li key={s.id} className="py-2" data-sat={s.id}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold leading-tight">{s.name} {s.live ? <Badge tone="green">Überflug läuft</Badge> : null}{!s.own ? <Badge>Allianz</Badge> : null}</div>
                  {s.live ? (
                    <div className="text-sm" data-testid="sat-live">live über {s.live.where} · noch {fmtDuration(s.live.untilMs - now)}</div>
                  ) : s.next ? (
                    <div className="text-sm" data-testid="sat-next">nächster Überflug in {fmtDuration(s.next.atMs - now)} über {s.next.where}</div>
                  ) : (
                    <div className="text-sm text-ink2">kein weiterer Überflug</div>
                  )}
                  <div className="text-xs text-ink2">aus {s.baseName} · Überflug {s.passesDone}/{s.passes} · verglüht {fmtTime(s.expiresAtMs)}</div>
                  {s.last && <div className="text-xs text-ink2">Zuletzt: {nOf(s.last.nests, "Nest", "Nester")}, {nOf(s.last.bases, "Hafen", "Häfen")}, {nOf(s.last.fleets, "Verband", "Verbände")}{s.last.clouded > 0 ? `, ${fmtNum(s.last.clouded)} unter Wolken` : ""}</div>}
                </div>
                {(s.live ?? s.next) && <SmallButton onClick={() => onShowOnMap(stripTarget((s.live ?? s.next)!))}>Karte</SmallButton>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {launch.pads.length === 0 ? (<>
        <p className="text-xs text-ink2 mt-2">
          Satelliten starten von einer Startrampe (Hafengebäude{requires ? `, braucht ${requires}` : ""}) mit Technik aus dem Zweig Raumfahrt.
          {ready ? " Voraussetzungen erfüllt." : missing ? ` Es fehlt noch: ${missing}.` : ""}
        </p>
        {ready && <SmallButton onClick={() => nav.go({ to: "building", id: "startrampe" })}>Startrampe bauen</SmallButton>}
      </>
      ) : (
        launch.pads.map((pad) => (
          <div key={pad.baseId} className="mt-3 border-t border-rule pt-2" data-testid="sat-launch">
            <div className="text-xs text-ink2 mb-1">Startrampe {pad.baseName} (Stufe {pad.padLevel})</div>
            {/* Höchstzahl erreicht: ein Hinweis für alle Arten statt je Art */}
            {pad.types.every((t) => t.code === "sat_limit") && <ReasonLine code="sat_limit" detail={{ building: "startrampe" }} className="text-xs text-ink2 mb-1" />}
            {pad.types.map((t) => (
              <div key={t.type} className="py-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="leading-tight">{t.name}</div>
                    <Cost cost={t.cost} />
                  </div>
                  <SmallButton disabled={!!t.code || start.busy} onClick={async () => {
                    const res = await start.run({ type: t.type as "optisch" | "radar", baseId: pad.baseId });
                    if (res?.ok) void queryClient.invalidateQueries(trpc.intel.pathFilter());
                  }}>Starten</SmallButton>
                </div>
                {t.code && t.code !== "sat_limit" && <ReasonLine code={t.code} text={errorText(t.code)} detail={{ cost: t.cost, building: "startrampe" }} className="text-xs text-ink2 mt-0.5" />}
              </div>
            ))}
          </div>
        ))
      )}
      <ErrorLine text={start.error} code={start.code} />
      <p className="text-xs text-ink2 mt-2">
        Alle {r.periodHours} h ein Überflug über {fmtNum(r.stripKm)} km Breite, je Überflug {fmtNum(r.shiftKm)} km weiter westlich; {r.liveMinutes} min live, danach bekannt.
        Optisch: Erkennung, nicht unter Wolken (über {Math.round((r.cloudMax ?? 0.6) * 100)} %). Radar: durch Wolken, nur Sichtung.
        Lebensdauer {r.lifetimeByType ? `optisch ${Math.round((r.lifetimeByType.optisch ?? r.lifetimeHours) / 24)}, Radar ${Math.round((r.lifetimeByType.radar ?? r.lifetimeHours) / 24)}` : Math.round(r.lifetimeHours / 24)} Tage, höchstens {r.max} (mit Radarsatellit {r.maxMore}).
      </p>
    </Card>
  );
}
