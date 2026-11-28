// Zweite (und letzte) Bauform für Umschalter (UX-0.43 B7): Ebene 1 sind die Unterstrich-Reiter (Segments in ui.tsx),
// Ebene 2 diese umbrechenden Filterchips – alle Einträge sichtbar, kein Scrollpfeil, nie eine dritte Ebene.
// Barrierefrei als Auswahlgruppe (radiogroup/radio): Pfeiltasten wechseln, nur der gewählte Chip liegt in der
// Tab-Reihenfolge. Zahl optional (badge), als kleine Pille rechts im Chip.
import type { KeyboardEvent, ReactNode } from "react";

export interface ChipItem<T extends string> { id: T; label: ReactNode; badge?: number }

export function FilterChips<T extends string>({ items, value, onChange, label: aria, className = "", testId }: {
  items: ChipItem<T>[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  testId?: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = Math.max(0, items.findIndex((t) => t.id === value));
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % items.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + items.length) % items.length
      : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    const group = e.currentTarget.parentElement;
    requestAnimationFrame(() => group?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus());
  };
  const focusIdx = Math.max(0, items.findIndex((t) => t.id === value));
  return (
    <div role="radiogroup" aria-label={aria} data-testid={testId} className={`flex flex-wrap gap-1.5 mb-3 ${className}`}>
      {items.map((t, i) => {
        const on = value === t.id;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={on} tabIndex={i === focusIdx ? 0 : -1}
            onClick={() => onChange(t.id)} onKeyDown={onKey}
            className={`tap min-h-9 rounded-full border px-3 py-1 text-[13px] font-serif inline-flex items-center gap-1.5 whitespace-nowrap ${on ? "border-ink bg-ink text-paper" : "border-rule bg-card text-ink2"}`}>
            <span>{t.label}</span>
            {!!t.badge && <span className={`min-w-5 h-5 px-1 rounded-full text-[11px] font-sans mono grid place-items-center ${on ? "bg-paper text-ink" : "bg-siegel text-white"}`}>{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
