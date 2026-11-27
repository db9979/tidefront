// Truppen → Einsatz, „Lohnende Ziele“: die nächsten Piratennester mit Entfernung, Fahrzeit und grober Siegchance
// (Probekampf im Browser, wie in der Missionsplanung) – „Angreifen“ und „Aufklären“ öffnen die Planung vorbelegt.
// Kartennebel (Lagebild): Die Stufe eines Nests kann fehlen – dann „Stufe unbekannt – erst aufklären“.
import { useEffect, useMemo, useState } from "react";
import type { Balance, BaseData, MapData } from "../../lib/trpc.ts";
import type { Target } from "../../App.tsx";
import { fmtNum } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { requestPlan } from "../../lib/plan-request.ts";
import { nearestNests, suggestRaid, suggestScout, travelMs, type Counts, type NestInfo } from "../../lib/strike.ts";
import { TacticalIcon } from "../../map/TacticalIcon.tsx";
import { Icon } from "../../icons.tsx";
import { Bar, Button, Card, SmallButton, UnitChips } from "../../ui.tsx";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];
const pct = (v: number) => `${fmtNum(Math.round(v * 100))} %`;

/** Siegchancen je Nest (Simulator wird erst hier nachgeladen; rechnet nach dem Zeichnen). */
function useWinRates(rows: { key: string; level: number | null; units: Counts }[], base: BaseData, balance: Balance): Record<string, number | null> {
  const [out, setOut] = useState<Record<string, number | null>>({});
  const sig = JSON.stringify(rows.map((r) => [r.key, r.level, r.units])) + JSON.stringify(base.modifiers ?? {}) + String(base.versorgungsmangel);
  useEffect(() => {
    let off = false;
    const t = setTimeout(() => {
      void import("../../lib/sim.ts").then(({ simulate, nestAsDefender }) => {
        if (off) return;
        const next: Record<string, number | null> = {};
        for (const r of rows) {
          if (r.level === null || Object.keys(r.units).length === 0) continue;
          const def = nestAsDefender(r.level, balance);
          if (!def) { next[r.key] = null; continue; }
          const res = simulate({ units: r.units, versorgungsmangel: base.versorgungsmangel, ...(base.modifiers ? { modifiers: base.modifiers as never } : {}) }, def, balance, 30);
          next[r.key] = res.ok ? res.stats.winRate : null;
        }
        setOut(next);
      });
    }, 50);
    return () => { off = true; clearTimeout(t); };
  }, [sig, balance]);
  return out;
}

function NestMark({ level }: { level: number | null }) {
  if (level !== null) return <TacticalIcon kind="nest" level={level} size={38} />;
  return (
    <svg viewBox="-17 -17 34 34" width={38} height={38} aria-hidden="true" className="shrink-0">
      <polygon points="0,-13 13,0 0,13 -13,0" fill="none" stroke="#a8331f" strokeWidth="1.6" strokeDasharray="3 2.5" />
      <text x="0" y="3.5" textAnchor="middle" fontSize="10" fontFamily="Fraunces, Georgia, serif" fontWeight="600" fill="#a8331f">?</text>
    </svg>
  );
}

export function TargetsCard({ base, balance, map, onShowOnMap }: { base: BaseData; balance: Balance; map: MapData | undefined; onShowOnMap: (t: Target) => void }) {
  const nests = useMemo(() => nearestNests(map, base), [map, base]);
  const rows = useMemo(() => nests.map((n) => ({ nest: n, key: String(n.id), level: n.level, units: suggestRaid(base, balance, n.distanceKm) })), [nests, base, balance]);
  const win = useWinRates(rows, base, balance);
  if (!map) return null;
  const fleet = rows[0]?.units ?? {};
  const noFleet = Object.keys(fleet).length === 0;
  return (
    <Card title="Lohnende Ziele" right={<span className="text-[11px] text-ink2">Piratennester in der Nähe</span>}>
      {rows.length === 0 ? (
        <div className="flex items-center gap-3">
          <NestMark level={null} />
          <p className="text-sm text-ink2 flex-1">Kein Piratennest in Sicht.</p>
          <SmallButton onClick={() => onShowOnMap({ col: base.col, row: base.row })}>Karte</SmallButton>
        </div>
      ) : (
        <>
          <div className="text-xs text-ink2 mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Vorschlag je Angriff:</span>
            {noFleet ? <span className="text-messing">keine Kampfeinheiten daheim</span> : <UnitChips counts={fleet} />}
          </div>
          <ul className="divide-y divide-rule">
            {rows.map((r) => <TargetRow key={r.key} nest={r.nest} units={r.units} rate={win[r.key]} base={base} balance={balance} onShowOnMap={onShowOnMap} />)}
          </ul>
          {!noFleet && <p className="text-[11px] text-ink2 mt-1">Siegchance: Probekampf mit dem Vorschlag, ohne Wetter. Raute antippen zeigt das Nest auf der Karte.</p>}
        </>
      )}
    </Card>
  );
}

function TargetRow({ nest, units, rate, base, balance, onShowOnMap }: { nest: NestInfo; units: Counts; rate: number | null | undefined; base: BaseData; balance: Balance; onShowOnMap: (t: Target) => void }) {
  const target = { col: nest.col, row: nest.row };
  const t = travelMs(units, nest.distanceKm, balance, base.modifiers);
  const known = nest.level !== null;
  const empty = Object.keys(units).length === 0;
  const tone = rate === undefined || rate === null ? null : rate >= 0.8 ? "green" : rate >= 0.5 ? "brass" : "red";
  const color = tone ? { green: "text-moos", brass: "text-messing", red: "text-siegel" }[tone] : "text-ink2";
  return (
    <li className="py-2" data-target={`${nest.col}/${nest.row}`}>
      <div className="flex items-start gap-2.5">
        <button type="button" onClick={() => onShowOnMap(target)} className="tap -m-1 p-1 shrink-0" aria-label={`Nest auf der Karte zeigen (Feld ${nest.col}/${nest.row})`}>
          <NestMark level={nest.level} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <strong className="font-serif text-[15px] leading-tight">{known ? `Nest Stufe ${ROMAN[nest.level!] ?? nest.level}` : "Stufe unbekannt"}</strong>
            {known && !empty && (
              <span className={`font-serif text-lg leading-none ${color}`} title="Siegchance laut Probekampf (30 Durchläufe)">
                {rate === undefined ? <span className="text-xs text-ink2 font-sans">rechnet …</span> : rate === null ? "–" : pct(rate)}
              </span>
            )}
          </div>
          <div className="text-xs text-ink2 mono flex flex-wrap gap-x-2">
            <span>{fmtNum(Math.round(nest.distanceKm))} km</span>
            {t !== null && <span className="inline-flex items-center gap-0.5"><Icon id="uhr" size={13} /> {fmtDuration(t)}</span>}
          </div>
          {!known && <p className="text-xs text-messing mt-0.5">Stufe unbekannt – erst aufklären.</p>}
          {known && !empty && tone && <div className="mt-1"><Bar value={rate ?? 0} tone={tone as "green" | "brass" | "red"} /></div>}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5 pl-[46px]">
        <Button className="flex-1" kind={known && (rate ?? 0) >= 0.5 ? "primary" : "secondary"} onClick={() => requestPlan({ target, type: "ueberfall", units })}>Angreifen</Button>
        <SmallButton onClick={() => requestPlan({ target, type: "aufklaerung", units: suggestScout(base, balance, nest.distanceKm) })}>Aufklären</SmallButton>
      </div>
    </li>
  );
}
