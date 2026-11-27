// Lebendige Nester: Besatzung, Anlagen und Beute eines Nests im Kartenblatt, in „Lohnende Ziele“ und in der Planung –
// mit Erkennung als Spanne („18–26 Schnellboote“, „Anlagen unbekannt“, „Beute 100–130 %“), mit Lagebild genau und
// hochgerechnet („Lagebild vor 5 h · jetzt voraussichtlich …“). Rechnung: lib/nest-intel.ts.
import { Icon } from "../icons.tsx";
import { countLabel, fmtNum, label } from "../lib/names.ts";
import { nestView, spanText, type MapNestLagebild, type NestView } from "../lib/nest-intel.ts";
import { fmtDuration } from "../lib/time.ts";
import type { Balance } from "../lib/trpc.ts";
import { agoText } from "./IntelStand.tsx";

const pct = (f: number) => `${Math.round(f * 100)} %`;

function UnitList({ list }: { list: { id: string; lo: number; hi: number }[] }) {
  if (list.length === 0) return <>keine</>;
  return (
    <>
      {list.map((s, i) => (
        <span key={s.id} className="inline-flex items-center gap-0.5 whitespace-nowrap">
          {i > 0 && <span className="mr-1">,</span>}
          <Icon id={s.id} size={14} />
          {spanText(s, fmtNum)} {countLabel(s.id, s.hi)}
        </span>
      ))}
    </>
  );
}

/** Zeilen zu einem besetzten Nest; `compact` ohne Rohstoffe der Beute (nur Prozent und Wert). */
export function NestIntel({ level, lagebild, now, balance, compact = false, view: given }: { level: number; lagebild: MapNestLagebild | null | undefined; now: number; balance: Balance; compact?: boolean; view?: NestView }) {
  const v = given ?? nestView(level, lagebild, now, balance);
  const tip = v.defenseSpan.map((s) => `${spanText(s, fmtNum)} ${countLabel(s.id, s.hi)}`).join(", ");
  return (
    <div className="text-xs text-slate-300 mt-0.5 space-y-0.5 break-words" data-testid="nest-intel" data-exact={v.exact && !!lagebild ? "1" : "0"}>
      <div className="flex flex-wrap items-center gap-x-1">Besatzung: <UnitList list={v.units} />{v.recovering && <span className="text-messing"> (geschwächt{v.fullAtMs ? `, voll in ${fmtDuration(v.fullAtMs - now)}` : ""})</span>}</div>
      <div className="flex flex-wrap items-center gap-x-1">
        Anlagen: {v.defenses === null ? <span title={tip ? `möglich: ${tip}` : undefined} data-testid="anlagen-unbekannt">unbekannt{tip ? ` (möglich: ${tip})` : ""}</span> : <UnitList list={v.defenses} />}
      </div>
      <div className="text-emerald-300" data-testid="nest-beute">
        Beute {v.lootFactor[0] === v.lootFactor[1] ? pct(v.lootFactor[0]) : `${pct(v.lootFactor[0])}–${pct(v.lootFactor[1])}`}
        {!compact && <>: {v.loot.map((r) => `${spanText(r, fmtNum)} ${label(r.id)}`).join(", ")}</>}
      </div>
      {lagebild && <div className="text-[11px] text-ink" data-testid="lagebild-alter">Lagebild {agoText(lagebild.atMs, now)} · jetzt voraussichtlich (Erholung und Beute hochgerechnet)</div>}
      {!lagebild && v.units.some((s) => s.lo !== s.hi) && <div className="text-[11px] text-ink2">Spanne aus der Erkennung – genau erst mit Lagebild (Aufklärung schicken).</div>}
    </div>
  );
}
