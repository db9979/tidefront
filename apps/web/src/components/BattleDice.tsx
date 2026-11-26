// Kampfbericht-Zubehör: W20-Zeichen des Kriegsglücks und Balken „ausgeteilter Schaden je Einheitentyp“.
import { fmtNum, label } from "../lib/names.ts";
import { Icon } from "../icons.tsx";

/** W20 als kleines Kupferstich-Zehneck mit Augenzahl; 1 = Panne (Siegelrot), 20 = Volltreffer (Moos). */
export function D20({ roll, die = 20, size = 26 }: { roll: number; die?: number; size?: number }) {
  const tone = roll <= 1 ? "text-siegel" : roll >= die ? "text-moos" : "text-ink";
  const title = roll <= 1 ? "Panne" : roll >= die ? "Volltreffer" : `Wurf ${roll}`;
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" className={`${tone} shrink-0`} role="img" aria-label={`W${die}: ${roll} (${title})`}>
      <title>{title}</title>
      <path d="M13 1.5 L23.5 7.5 L23.5 18.5 L13 24.5 L2.5 18.5 L2.5 7.5 Z" fill="var(--color-card)" stroke="currentColor" strokeWidth="1.3" />
      <path d="M13 1.5 L7 15.5 L19 15.5 Z M7 15.5 L13 24.5 L19 15.5 M2.5 7.5 L7 15.5 M23.5 7.5 L19 15.5" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.45" />
      <text x="13" y="13.8" textAnchor="middle" dominantBaseline="middle" fontSize={roll >= 10 ? 8.5 : 9.5} fontWeight="700" fill="currentColor" fontFamily="ui-monospace, monospace">{roll}</text>
    </svg>
  );
}

/** Würfe beider Seiten einer Phase mit Faktor (z. B. „+12 %“). */
export function PhaseDice({ luck, names, factor }: { luck: { attacker: number; defender: number }; names: [string, string]; factor: { attacker: number; defender: number } | null }) {
  const pct = (side: "attacker" | "defender") => {
    if (!factor) return "";
    const f = factor[side];
    const p = Math.round((f - 1) * 100);
    return p === 0 ? "±0 %" : `${p > 0 ? "+" : "−"}${Math.abs(p)} %`;
  };
  return (
    <div className="flex items-center gap-3 text-[11.5px] text-ink2 mt-1.5" aria-label="Kriegsglück">
      <span className="font-display uppercase tracking-[0.1em] text-[10px]">Kriegsglück</span>
      {(["attacker", "defender"] as const).map((side, i) => (
        <span key={side} className="flex items-center gap-1 min-w-0">
          <D20 roll={luck[side]} size={22} />
          <span className="truncate max-w-[7rem]">{names[i]}</span>
          <span className="mono">{pct(side)}</span>
        </span>
      ))}
    </div>
  );
}

/** Ausgeteilter Schaden je Einheitentyp beider Seiten als Balken (größter Wert = volle Breite). */
export function DamageBars({ damage, names }: { damage: { attacker: Record<string, number>; defender: Record<string, number> }; names: [string, string] }) {
  const rows: { side: 0 | 1; id: string; d: number }[] = [];
  (["attacker", "defender"] as const).forEach((side, i) => {
    for (const [id, d] of Object.entries(damage[side] ?? {})) if (d >= 0.5) rows.push({ side: i as 0 | 1, id, d });
  });
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.d - a.d);
  const max = rows[0].d;
  return (
    <div className="mt-1.5" aria-label="Ausgeteilter Schaden je Einheitentyp">
      <div className="font-display uppercase tracking-[0.1em] text-[10px] text-ink2 mb-0.5">Ausgeteilter Schaden</div>
      <ul className="space-y-0.5">
        {rows.slice(0, 8).map((r) => (
          <li key={`${r.side}-${r.id}`} className="grid grid-cols-[18px_minmax(0,7.5rem)_1fr_auto] items-center gap-1.5 text-[11px]">
            <Icon id={r.id} size={18} />
            <span className="truncate">{label(r.id)} <span className="text-ink2">({names[r.side]})</span></span>
            <span className="h-2 rounded-[2px] bg-inset border border-rule overflow-hidden">
              <span className={`block h-full ${r.side === 0 ? "bg-see" : "bg-siegel"}`} style={{ width: `${Math.max(2, (r.d / max) * 100)}%` }} />
            </span>
            <span className="mono text-ink2 text-right w-12">{fmtNum(r.d)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
