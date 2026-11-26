import { useEffect, type ReactNode } from "react";
import { countLabel, fmtNum, label } from "./lib/names.ts";
import { Icon } from "./icons.tsx";

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="panel rounded-2xl p-3 mb-3">
      {title !== undefined && (
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className="font-display text-sm font-bold uppercase text-brass-300">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnKind = "primary" | "secondary" | "danger" | "ghost";
const KIND: Record<BtnKind, string> = {
  primary: "btn-primary font-bold",
  secondary: "bg-navy-700 text-white active:bg-navy-600",
  danger: "bg-red-700 text-white active:bg-red-600",
  ghost: "bg-transparent text-sea-300 underline",
};

export function Button(props: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: BtnKind; className?: string; type?: "button" | "submit" }) {
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`tap rounded-lg px-4 py-2 disabled:opacity-40 ${KIND[props.kind ?? "primary"]} ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}

export function ErrorLine({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <p className="text-red-300 text-sm mt-2" role="alert">{text}</p>;
}

export function Cost({ cost, have }: { cost: Record<string, number> | null | undefined; have?: Record<string, number> }) {
  if (!cost) return null;
  const parts = Object.entries(cost).filter(([, v]) => v > 0);
  if (parts.length === 0) return <span className="text-xs text-slate-400">kostenlos</span>;
  return (
    <span className="text-xs flex flex-wrap gap-x-2">
      {parts.map(([r, v]) => (
        <span key={r} className={have && (have[r] ?? 0) < v ? "text-red-300" : "text-slate-300"}>
          <Icon id={r} size={14} className="inline -mt-0.5" /> {fmtNum(v)}
        </span>
      ))}
    </span>
  );
}

export function Stepper({ value, onChange, max }: { value: number; onChange: (v: number) => void; max?: number }) {
  const clamp = (v: number) => Math.max(0, Math.min(max ?? Infinity, Math.floor(v || 0)));
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="tap rounded-lg bg-navy-700 text-lg" onClick={() => onChange(clamp(value - 1))} aria-label="weniger">−</button>
      <input
        inputMode="numeric"
        className="w-16 h-11 rounded-lg bg-navy-950 border border-navy-600 text-center"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, ""))))}
      />
      <button type="button" className="tap rounded-lg bg-navy-700 text-lg" onClick={() => onChange(clamp(value + 1))} aria-label="mehr">+</button>
      {max !== undefined && (
        <button type="button" className="tap rounded-lg bg-navy-700 text-xs px-2" onClick={() => onChange(max)}>alle</button>
      )}
    </div>
  );
}

export function CountsLine({ counts }: { counts: Record<string, number> | null | undefined }) {
  const parts = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
  if (parts.length === 0) return <span className="text-slate-400">–</span>;
  return <span>{parts.map(([id, n]) => `${fmtNum(n)} ${countLabel(id, n)}`).join(", ")}</span>;
}

export function Loading() {
  return (
    <div className="h-full grid place-items-center p-8 text-slate-400">
      <div className="flex flex-col items-center gap-3">
        <Icon id="anker" size={48} className="animate-pulse" />
        <span className="font-display uppercase text-sm">Lädt …</span>
      </div>
    </div>
  );
}

/** Blatt von unten (Info und Aktionen); Schließen per Hintergrund, Knopf oder Escape. */
export function Sheet({ open, onClose, title, icon, children }: { open: boolean; onClose: () => void; title: ReactNode; icon?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Schließen" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="sheet-in relative w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-t-3xl panel brass-edge p-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
        <div className="flex items-center gap-3 mb-3">
          {icon}
          <h2 className="font-display text-xl font-bold flex-1 min-w-0">{title}</h2>
          <button type="button" className="tap rounded-full bg-navy-700 text-lg" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatTable({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-400">{k}</dt>
          <dd className="text-right tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Fortschrittsbalken mit Streifen, solange er läuft. */
export function Bar({ value, tone = "sea" }: { value: number; tone?: "sea" | "brass" | "red" | "green" }) {
  const color = { sea: "bg-sea-400", brass: "bg-brass-400", red: "bg-red-500", green: "bg-emerald-400" }[tone];
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="h-2 w-full rounded-full bg-navy-950/80 overflow-hidden border border-white/5">
      <div className={`h-full ${color} ${v > 0 && v < 1 ? "stripes" : ""}`} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "brass" | "green" | "red" | "sea" }) {
  const c = {
    slate: "bg-navy-700 text-slate-200",
    brass: "bg-brass-400 text-navy-950",
    green: "bg-emerald-700 text-white",
    red: "bg-red-700 text-white",
    sea: "bg-sea-400 text-navy-950",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${c}`}>{children}</span>;
}

/** Ressourcen als Symbol und Zahl. */
export function ResChips({ values, empty = "–" }: { values: Record<string, number> | null | undefined; empty?: string }) {
  const parts = Object.entries(values ?? {}).filter(([, v]) => v > 0);
  if (parts.length === 0) return <span className="text-slate-400">{empty}</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
      {parts.map(([r, v]) => (
        <span key={r} className="inline-flex items-center gap-1 tabular-nums"><Icon id={r} size={18} /> {fmtNum(v)}</span>
      ))}
    </span>
  );
}

/** Einheiten als Symbol und Anzahl. */
export function UnitChips({ counts }: { counts: Record<string, number> | null | undefined }) {
  const parts = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
  if (parts.length === 0) return <span className="text-slate-400">–</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
      {parts.map(([id, n]) => (
        <span key={id} className="inline-flex items-center gap-1 tabular-nums" title={label(id)}><Icon id={id} size={20} /> {fmtNum(n)} <span className="text-slate-400 text-xs">{countLabel(id, n)}</span></span>
      ))}
    </span>
  );
}
