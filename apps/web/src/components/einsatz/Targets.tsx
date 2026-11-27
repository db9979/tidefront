// Truppen → Einsatz, „Lohnende Ziele“: die nächsten Piratennester mit Entfernung, Fahrzeit und Siegchance. Der Verband
// je Nest kommt aus dem Probekampf (game-core raid-plan, im Browser nachgeladen): der kleinste aus dem, was daheim
// liegt, mit ≥ 90 % Sieg – nicht einfach alles. Reicht der Bestand nicht, steht dabei, was fehlt.
// Kartennebel (Lagebild): Die Stufe eines Nests kann fehlen – dann „Stufe unbekannt – erst aufklären“. Ausnahme: das
// Ziel des Nest-Auftrags (Auftragsbuch, nestTarget) ist immer mit Stufe bekannt und steht immer in der Liste, ebenso
// alle bekannten Nester der Stufe 1 in 300 km.
// Lebendige Nester: Erkannte Nester zeigen Besatzung, Anlagen und Beute (Spanne bzw. mit Lagebild genau und
// hochgerechnet, Alter des Lagebilds) und eine Bewertung „lohnend?“ (Netto zum Richtpreis: Beute bei Sieg gegen
// Treibstoff hin und zurück und erwartete Verluste). Sortierung: lohnend und erreichbar zuerst.
import { useEffect, useMemo, useState } from "react";
import { seaRoute } from "@tidefront/world";
import type { Balance, BaseData, MapData } from "../../lib/trpc.ts";
import type { Target } from "../../App.tsx";
import { countLabel, fmtNum } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { requestPlan } from "../../lib/plan-request.ts";
import { nearestNests, suggestRaid, suggestScout, travelMs, type Counts, type NestInfo } from "../../lib/strike.ts";
import type { NestPlan } from "../../lib/raid-plan.ts";
import { useGuide } from "../Guide.tsx";
import { TacticalIcon } from "../../map/TacticalIcon.tsx";
import { Icon } from "../../icons.tsx";
import { Badge, Bar, Button, Card, SmallButton, UnitChips } from "../../ui.tsx";
import { ReasonLine } from "../Remedy.tsx"; // ohne Kampfeinheiten: „Angreifen“ erklärt, was hilft
import { NestIntel } from "../NestIntel.tsx"; // Lebendige Nester: Besatzung, Anlagen, Beute
import { agoText } from "../IntelStand.tsx";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];
const pct = (v: number) => `${fmtNum(Math.round(v * 100))} %`;
/** Nester der Stufe 1 bis zu dieser Entfernung stehen immer in der Liste (wie das zugesicherte Start-Nest). */
const LEVEL1_KM = 300;
const MAX_ROWS = 5;

type Row = { nest: NestInfo; key: string; full: Counts; mission: boolean };

/** Auswahl: die drei nächsten, dazu Stufe-1-Nester in LEVEL1_KM und das Auftragsziel (Stufe von dort, falls unbekannt). */
export function pickNests(all: NestInfo[], mission: { id: number; level: number } | null): (NestInfo & { mission: boolean })[] {
  const withLevel = all.map((n) => ({ ...n, level: n.level ?? (mission && n.id === mission.id ? mission.level : null), mission: !!mission && n.id === mission.id }));
  const pick = new Map<number, (typeof withLevel)[number]>();
  for (const n of withLevel.slice(0, 3)) pick.set(n.id, n);
  for (const n of withLevel) if (n.mission || (n.level === 1 && n.distanceKm <= LEVEL1_KM)) pick.set(n.id, n);
  // Lebendige Nester: aufgeklärte Nester (genaues Lagebild) in der Nähe gehören dazu.
  for (const n of withLevel.filter((x) => x.lagebild).slice(0, 2)) pick.set(n.id, n);
  return [...pick.values()].sort((a, b) => Number(b.mission) - Number(a.mission) || a.distanceKm - b.distanceKm).slice(0, MAX_ROWS).sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Vorschläge je Nest aus dem Probekampf (nachgeladen; rechnet nach dem Zeichnen). */
function usePlans(rows: Row[], base: BaseData, balance: Balance): Record<string, NestPlan | null> {
  const [out, setOut] = useState<Record<string, NestPlan | null>>({});
  const sig = JSON.stringify(rows.map((r) => [r.key, r.nest.level, r.full, r.nest.lagebild?.atMs ?? null])) + JSON.stringify(base.modifiers ?? {}) + String(base.versorgungsmangel);
  useEffect(() => {
    let off = false;
    const t = setTimeout(() => {
      void import("../../lib/raid-plan.ts").then(({ planNestRaid }) => {
        if (off) return;
        const next: Record<string, NestPlan | null> = {};
        for (const r of rows) {
          if (r.nest.level === null || Object.keys(r.full).length === 0) continue;
          next[r.key] = planNestRaid(r.full, r.nest.level, balance, { versorgungsmangel: base.versorgungsmangel, modifiers: base.modifiers, lagebild: r.nest.lagebild, travelKm: travelKmOf(base, r.nest, r.full, balance) });
        }
        setOut(next);
      });
    }, 50);
    return () => { off = true; clearTimeout(t); };
  }, [sig, balance]);
  return out;
}

/** Fahrstrecke: mit Schiffen der Seeweg, sonst Luftlinie. */
function travelKmOf(base: { col: number; row: number }, nest: { col: number; row: number; distanceKm: number }, units: Counts, balance: Balance): number {
  const ships = Object.entries(units).some(([id, n]) => n > 0 && balance.units[id]?.branch === "see");
  return ships ? Math.max(nest.distanceKm, seaRoute(base, nest).km) : nest.distanceKm;
}

/** Lohnend und erreichbar: Vorschlag reicht (≥ 90 %) und netto im Plus. */
const worthwhile = (p: NestPlan | null | undefined) => !!p && p.enough && !!p.worth && p.worth.net[0] > 0;

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
  const guide = useGuide();
  const mission = guide.data?.nestTarget ?? null;
  const nests = useMemo(() => pickNests(nearestNests(map, base, 60), mission), [map, base, mission?.id, mission?.level]);
  const rows: Row[] = useMemo(() => nests.map((n) => ({ nest: n, key: String(n.id), full: suggestRaid(base, balance, n.distanceKm), mission: n.mission })), [nests, base, balance]);
  const plans = usePlans(rows, base, balance);
  if (!map) return null;
  const noFleet = rows.every((r) => Object.keys(r.full).length === 0);
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
          {noFleet && <p className="text-xs text-messing mb-1">Keine Kampfeinheiten daheim.</p>}
          <ul className="divide-y divide-rule">
            {[...rows].sort((a, b) => Number(worthwhile(plans[b.key])) - Number(worthwhile(plans[a.key])) || Number(b.mission) - Number(a.mission) || a.nest.distanceKm - b.nest.distanceKm).map((r) => <TargetRow key={r.key} row={r} plan={plans[r.key]} base={base} balance={balance} onShowOnMap={onShowOnMap} />)}
          </ul>
          {!noFleet && <p className="text-[11px] text-ink2 mt-1">Vorschlag: kleinster Verband aus deinem Bestand, der im Probekampf (ohne Wetter) mindestens 9 von 10 Kämpfen gewinnt – mit Lagebild genau, sonst im Mittel über die Spanne der Besatzung. Netto: Beute bei Sieg zum Richtpreis minus Treibstoff hin und zurück und erwartete Verluste. Raute antippen zeigt das Nest auf der Karte.</p>}
        </>
      )}
    </Card>
  );
}

function TargetRow({ row, plan, base, balance, onShowOnMap }: { row: Row; plan: NestPlan | null | undefined; base: BaseData; balance: Balance; onShowOnMap: (t: Target) => void }) {
  const { nest, full } = row;
  const target = { col: nest.col, row: nest.row };
  const units = plan?.units ?? full;
  const rate = plan === undefined ? undefined : plan?.winRate ?? null;
  const t = travelMs(units, nest.distanceKm, balance, base.modifiers);
  const known = nest.level !== null;
  const empty = Object.keys(full).length === 0;
  const tone = rate === undefined || rate === null ? null : rate >= 0.8 ? "green" : rate >= 0.5 ? "brass" : "red";
  const color = tone ? { green: "text-moos", brass: "text-messing", red: "text-siegel" }[tone] : "text-ink2";
  const [why, setWhy] = useState(false);
  const scout = () => requestPlan({ target, type: "aufklaerung", units: suggestScout(base, balance, nest.distanceKm) });
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
              <span className={`font-serif text-lg leading-none ${color}`} title="Siegchance des Vorschlags laut Probekampf (100 Durchläufe)">
                {rate === undefined ? <span className="text-xs text-ink2 font-sans">rechnet …</span> : rate === null ? "–" : pct(rate)}
              </span>
            )}
          </div>
          <div className="text-xs text-ink2 mono flex flex-wrap items-center gap-x-2">
            <span>{fmtNum(Math.round(nest.distanceKm))} km</span>
            {t !== null && <span className="inline-flex items-center gap-0.5"><Icon id="uhr" size={13} /> {fmtDuration(t)}</span>}
            {row.mission && <Badge tone="brass">Auftragsziel</Badge>}
          </div>
          {!known && <p className="text-xs text-messing mt-0.5">Stufe unbekannt – erst aufklären.</p>}
          {known && !empty && tone && <div className="mt-1"><Bar value={rate ?? 0} tone={tone as "green" | "brass" | "red"} /></div>}
          {known && <WorthLine nest={nest} plan={plan} />}
          {known && (
            <details className="mt-0.5 text-xs" data-testid="ziel-details">
              <summary className="cursor-pointer text-ink2">Details</summary>
              <NestIntel level={nest.level!} lagebild={nest.lagebild} now={Date.now()} balance={balance} compact />
              {plan?.worth && <p className="text-[11px] text-ink2 mt-0.5">Beute bei Sieg ≈ {fmtNum(Math.round(plan.worth.loot[0]))}{plan.worth.loot[1] > plan.worth.loot[0] + 1 ? `–${fmtNum(Math.round(plan.worth.loot[1]))}` : ""} · Verluste ≈ {fmtNum(Math.round(plan.worth.loss))} · Treibstoff ≈ {fmtNum(Math.round(plan.worth.fuel))} (Richtpreis)</p>}
            </details>
          )}
          {!empty && <div className="text-xs mt-1" aria-label="Vorgeschlagener Verband"><UnitChips counts={units} /></div>}
          {plan && !plan.enough && <p className="text-xs text-messing mt-0.5">{shortfall(plan)}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5 pl-[46px]">
        {empty ? <>
          <Button className="flex-1" onClick={scout}>Aufklären</Button>
          <Button kind="secondary" disabled onBlocked={() => setWhy(!why)}>Angreifen</Button>
        </> : <>
          <Button className="flex-1" kind={known && (rate ?? 0) >= 0.5 ? "primary" : "secondary"} onClick={() => requestPlan({ target, type: "ueberfall", units })}>Angreifen</Button>
          <SmallButton onClick={scout}>Aufklären</SmallButton>
        </>}
      </div>
      {empty && why && <div className="pl-[46px]"><ReasonLine code="no_combat_units" open onOpenChange={setWhy} /></div>}
    </li>
  );
}

/** Kurzzeile: Lagebild-Alter, Spanne der Siegchance, Netto. */
function WorthLine({ nest, plan }: { nest: NestInfo; plan: NestPlan | null | undefined }) {
  const parts: string[] = [];
  if (nest.lagebild) parts.push(`Lagebild ${agoText(nest.lagebild.atMs, Date.now())}`);
  else parts.push("nur Erkennung");
  if (plan?.range) parts.push(`Sieg ${pct(plan.range.min)}–${pct(plan.range.max)}, Ø ${pct(plan.range.mean)}`);
  const w = plan?.worth;
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${fmtNum(Math.abs(Math.round(v / 100) * 100))}`;
  const net = w ? (Math.abs(w.net[1] - w.net[0]) < 100 ? `Netto etwa ${signed(w.net[0])}` : `Netto etwa ${signed(w.net[0])} bis ${signed(w.net[1])}`) : null;
  return (
    <div className="text-[11px] mt-0.5 flex flex-wrap gap-x-2" data-testid="ziel-wert">
      <span className="text-ink2">{parts.join(" · ")}</span>
      {net && <span className={w!.net[0] > 0 ? "text-moos" : "text-siegel"}>{net}</span>}
    </div>
  );
}

/** Was fehlt, damit der Überfall sicher gelingt. */
function shortfall(p: NestPlan): string {
  if (p.extra !== null && p.extraId) return `Noch nicht sicher: mit ${fmtNum(p.extra)} ${countLabel(p.extraId, p.extra)} mehr gewinnst du mindestens 9 von 10 Kämpfen.`;
  return "Noch nicht sicher: mehr Truppen und Landungsschiffe ausbilden oder ein schwächeres Nest wählen.";
}
