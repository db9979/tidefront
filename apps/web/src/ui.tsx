import type { ReactNode } from "react";
import { RES_ICON, fmtNum, label } from "./lib/names.ts";

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl bg-navy-800 border border-navy-700 p-3 mb-3">
      {title !== undefined && (
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-sea-300">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnKind = "primary" | "secondary" | "danger" | "ghost";
const KIND: Record<BtnKind, string> = {
  primary: "bg-sea-400 text-navy-950 font-semibold active:bg-sea-300",
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
          {RES_ICON[r] ?? ""} {fmtNum(v)}
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
  return <span>{parts.map(([id, n]) => `${fmtNum(n)} ${label(id)}`).join(", ")}</span>;
}

export function Loading() {
  return <p className="p-4 text-slate-400">Lädt …</p>;
}
