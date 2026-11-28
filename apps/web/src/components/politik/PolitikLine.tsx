// Weltpolitik auf der Lage (UX 0.43, A1 / W-8): groß (PolitikPanel) nur bei Handlungsbedarf – offene Seerat-Abstimmung,
// Paktangebot – oder wirkender Gezeit/Beschluss; sonst eine Zeile, die zu Meldungen → Saison → Welt springt
// (dort Kalender, Zeitleiste, Ergebnisse). Neulinge sehen die Zeile in Ruhe gar nicht (A3).
import { fmtTime, useCountdownNow } from "../../lib/time.ts";
import { useNav } from "../../lib/nav.ts";
import { Icon } from "../../icons.tsx";
import { PolitikPanel } from "./PolitikPanel.tsx";
import { usePolitik } from "./use-politik.ts";

export function PolitikLage({ newcomer = false }: { newcomer?: boolean }) {
  const nav = useNav();
  const q = usePolitik();
  const d = q.data;
  const now = useCountdownNow(d?.nextChangeMs);
  if (!d || !d.enabled) return null;
  const open = d.seerat.some((s) => s.status === "offen");
  const active = d.windows.filter((w) => w.effect !== "ruhig" && w.active && w.endMs > now);
  if (open || d.pakte.length > 0) return <PolitikPanel />;
  if (newcomer && active.length === 0) return null;
  const text = active.length > 0 ? active.map((w) => w.name).join(" · ") : "ruhig – keine Gezeit in Kraft";
  return (
    <button type="button" data-testid="politik-line" onClick={() => nav.go({ to: "meldungen", sub: "welt" })}
      className="tap w-full panel rounded-xl px-3.5 py-2 mb-3 flex items-center gap-2 text-left text-sm">
      <Icon id="wind" size={18} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate"><span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink2 mr-1.5">Weltpolitik</span>{text}</span>
      {d.nextChangeMs && <span className="mono text-[11px] text-ink2 shrink-0">{fmtTime(d.nextChangeMs, now)}</span>}
      <span aria-hidden className="text-ink2">›</span>
    </button>
  );
}
