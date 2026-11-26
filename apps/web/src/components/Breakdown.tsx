// Wertaufschlüsselung im Info-Blatt: je Wert Grund- und Endwert, darunter die Quellen („Grundwert 40 · Forschung +10 %“).
import type { BaseData } from "../lib/trpc.ts";
import { rowValue, type BreakdownRow } from "../lib/breakdown.ts";

export function Breakdown({ rows, digits = 0 }: { rows: BreakdownRow[]; digits?: number }) {
  if (rows.length === 0) return null;
  return (
    <dl className="text-sm">
      {rows.map((r) => {
        const changed = r.parts.length > 1;
        return (
          <div key={r.label} className="py-1 border-b border-dotted border-rule">
            <div className="flex justify-between gap-3">
              <dt className="text-ink2">{r.label}</dt>
              <dd className={`mono text-right ${changed ? "text-moos font-semibold" : ""}`}>{rowValue(r, digits)}</dd>
            </div>
            {changed && <div className="text-[11.5px] text-ink2 mt-0.5">{r.parts.join(" · ")}</div>}
          </div>
        );
      })}
    </dl>
  );
}

type Vet = BaseData["veterans"][number];

/** Veteranenrang einer Einheit: Rang, Erfahrung, Angriffsbonus, nächster Rang. */
export function VeteranLine({ vet }: { vet: Vet | undefined }) {
  if (!vet) return null;
  return (
    <p className="text-sm mt-2 flex items-center gap-2 flex-wrap">
      <RankBadge vet={vet} />
      <span className="text-ink2">
        Erfahrung {String(vet.xp).replace(".", ",")}
        {vet.attackBonus > 0 ? ` · Angriff +${Math.round(vet.attackBonus * 100)} %` : ""}
        {vet.next ? ` · ${vet.next.name} ab ${vet.next.minXp}` : " · höchster Rang"}
      </span>
    </p>
  );
}

/** Kleines Rangabzeichen (Winkel je Rang). */
export function RankBadge({ vet }: { vet: Vet }) {
  const level = { rekrut: 0, erprobt: 1, veteran: 2, elite: 3 }[vet.rank] ?? 0;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 rounded-[3px] border text-[11px] font-display uppercase tracking-[0.08em] ${level > 0 ? "border-moos text-moos" : "border-rule text-ink2"}`}>
      {level > 0 && (
        <svg width={10} height={4 + level * 3} viewBox={`0 0 10 ${4 + level * 3}`} aria-hidden="true">
          {Array.from({ length: level }, (_, i) => (
            <path key={i} d={`M1 ${1 + i * 3} L5 ${4 + i * 3} L9 ${1 + i * 3}`} fill="none" stroke="currentColor" strokeWidth="1.4" />
          ))}
        </svg>
      )}
      {vet.rankName}
    </span>
  );
}
