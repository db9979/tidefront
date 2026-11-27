// Weltpolitik: wirkende Verschiebung dort, wo sie wirkt (Order, Verträge, Konvoi, Spielerhandel) – „Gezeit:
// Börsengebühr 6 % · noch 1 T 4 h (bis morgen 14:00 Uhr), danach 4 %“. Restzeit läuft live.
import { useCountdownNow, fmtDuration, fmtTime } from "../../lib/time.ts";
import { Icon } from "../../icons.tsx";
import { usePolitik, type EffectKey } from "./use-politik.ts";

export function EffectHint({ keys, className = "" }: { keys: EffectKey[]; className?: string }) {
  const q = usePolitik();
  const lines = (q.data?.lines ?? []).filter((l) => keys.includes(l.key));
  const until = lines[0]?.untilMs ?? null;
  const now = useCountdownNow(until);
  if (lines.length === 0) return null;
  const label = q.data?.windows.find((w) => w.active)?.slot === "woche" || q.data?.windows.find((w) => w.active)?.source === "seerat" ? "Seerat-Beschluss" : "Gezeit";
  return (
    <div className={`rounded-lg border border-messing bg-inset p-2 text-xs flex gap-2 items-start ${className}`} data-testid="politik-hint" role="note">
      <Icon id="wind" size={18} />
      <ul className="flex-1 min-w-0 space-y-0.5">
        {lines.map((l) => (
          <li key={l.key + l.text}>
            <strong>{label}:</strong> {l.text}
            {l.untilMs !== null && <> · noch <span className="mono">{fmtDuration(l.untilMs - now)}</span> (bis {fmtTime(l.untilMs, now)})</>}
            {l.after && <>, danach {l.after}</>}
          </li>
        ))}
      </ul>
    </div>
  );
}
