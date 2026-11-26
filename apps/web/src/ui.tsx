import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { countLabel, fmtNum, label } from "./lib/names.ts";
import { Icon } from "./icons.tsx";
import { useBackLayer } from "./lib/back.ts";

/** Auf-/Zu-Zustand, auf Wunsch in localStorage gemerkt (Schlüssel „tf-open:…“). */
export function useStoredOpen(storageKey: string | undefined, defaultOpen: boolean): [boolean, (v: boolean) => void] {
  const [open, setOpenState] = useState(() => {
    if (!storageKey) return defaultOpen;
    const v = localStorage.getItem(`tf-open:${storageKey}`);
    return v === null ? defaultOpen : v === "1";
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (storageKey) localStorage.setItem(`tf-open:${storageKey}`, v ? "1" : "0");
  };
  return [open, setOpen];
}

/**
 * Karte mit Kopfzeile. collapsible: Kopf wird zum Knopf (▾/▴), zugeklappt steht nur summary unter dem Titel;
 * storageKey merkt den Zustand geräteweit, defaultOpen gilt ohne gemerkten Zustand.
 */
export function Card({ title, children, right, collapsible, summary, storageKey, defaultOpen = true, id }: {
  title?: ReactNode; children: ReactNode; right?: ReactNode;
  collapsible?: boolean; summary?: ReactNode; storageKey?: string; defaultOpen?: boolean; id?: string;
}) {
  const [stored, setOpen] = useStoredOpen(collapsible ? storageKey : undefined, defaultOpen);
  const open = !collapsible || stored;
  const h2 = "font-display text-[11px] uppercase text-ink2 tracking-[0.16em] flex items-center gap-2 min-w-0";
  return (
    <section id={id} className="panel rounded-xl p-3.5 mb-3">
      {title !== undefined && (collapsible ? (
        <div className={`flex items-start justify-between gap-2 ${open ? "mb-2" : ""}`}>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="tap -my-2 py-2 flex-1 min-w-0 text-left">
            <h2 className={h2}>{title}<span aria-hidden className="ml-auto text-ink2 text-[13px] leading-none">{open ? "▴" : "▾"}</span></h2>
            {!open && summary !== undefined && <div className="mt-1 text-sm text-ink normal-case tracking-normal font-sans">{summary}</div>}
          </button>
          {right}
        </div>
      ) : (
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className={h2}>{title}</h2>
          {right}
        </div>
      ))}
      {open && children}
    </section>
  );
}

type BtnKind = "primary" | "secondary" | "danger" | "ghost";
const KIND: Record<BtnKind, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  ghost: "bg-transparent text-see underline underline-offset-4 normal-case tracking-normal",
};

export function Button(props: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: BtnKind; className?: string; type?: "button" | "submit" }) {
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`tap rounded-lg px-4 py-2 font-display uppercase text-[13px] tracking-[0.12em] disabled:opacity-45 ${KIND[props.kind ?? "primary"]} ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}

/** Fehlermeldung am auslösenden Element; rollt bei neuer Meldung in den sichtbaren Bereich. */
export function ErrorLine({ text }: { text: string | null | undefined }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (text) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [text]);
  if (!text) return null;
  return <p ref={ref} className="text-red-300 text-sm mt-2 scroll-mb-24" role="alert">{text}</p>;
}

export function Cost({ cost, have }: { cost: Record<string, number> | null | undefined; have?: Record<string, number> }) {
  if (!cost) return null;
  const parts = Object.entries(cost).filter(([, v]) => v > 0);
  if (parts.length === 0) return <span className="text-xs text-slate-400">kostenlos</span>;
  return (
    <span className="text-xs flex flex-wrap gap-x-2">
      {parts.map(([r, v]) => (
        <span key={r} className={`mono ${have && (have[r] ?? 0) < v ? "text-siegel font-semibold" : "text-slate-300"}`}>
          <Icon id={r} size={14} className="inline -mt-0.5" /> {fmtNum(v)}
        </span>
      ))}
    </span>
  );
}

/** Ganzzahl-Eingabe; max zeigt „alle“, limit begrenzt nur (z. B. auf das Bezahlbare). */
export function Stepper({ value, onChange, max, limit }: { value: number; onChange: (v: number) => void; max?: number; limit?: number }) {
  const clamp = (v: number) => Math.max(0, Math.min(max ?? Infinity, limit ?? Infinity, Math.floor(v || 0)));
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="tap rounded-lg btn-secondary text-lg" onClick={() => onChange(clamp(value - 1))} aria-label="weniger">−</button>
      <input
        inputMode="numeric"
        className="w-16 h-11 rounded-lg field text-center mono"
        maxLength={8}
        value={value}
        // Nur der ganzzahlige Teil zählt: „1.5“ wird 1, nicht 15.
        onChange={(e) => onChange(clamp(Number(e.target.value.split(/[.,]/)[0].replace(/\D/g, ""))))}
      />
      <button type="button" className="tap rounded-lg btn-secondary text-lg" onClick={() => onChange(clamp(value + 1))} aria-label="mehr">+</button>
      {max !== undefined && (
        <button type="button" className="tap rounded-lg btn-secondary text-xs px-2" onClick={() => onChange(max)}>alle</button>
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
    <div className="h-full grid place-items-center p-8 text-slate-400" data-loading>
      <div className="flex flex-col items-center gap-3">
        <Icon id="anker" size={48} className="animate-pulse" />
        <span className="font-serif italic text-base text-ink2">Lädt …</span>
      </div>
    </div>
  );
}

/** Blatt von unten (Info und Aktionen); Schließen per Hintergrund, Knopf, Escape oder Zurück-Taste. */
export function Sheet({ open, onClose, title, icon, children }: { open: boolean; onClose: () => void; title: ReactNode; icon?: ReactNode; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; dy: number; grip: boolean } | null>(null);
  useBackLayer(open, onClose, 5);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;

  // Griff und Kopfzeile: nach unten ziehen schließt das Blatt (ab 80 px), Antippen des Griffs ohne Bewegung ebenso.
  const setOffset = (dy: number, animate: boolean) => {
    const el = panel.current;
    if (!el) return;
    el.style.transition = animate ? "transform 160ms ease-out" : "none";
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };
  const onDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("button[data-close]")) return;
    drag.current = { startY: e.clientY, dy: 0, grip: !!t.closest("[data-grip]") };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.startY);
    setOffset(drag.current.dy, false);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.dy > 80 || (d.grip && d.dy < 6 && e.type === "pointerup")) onClose();
    else setOffset(0, true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Schließen" className="absolute inset-0 bg-ink/45" onClick={onClose} />
      <div ref={panel} className="sheet-in relative w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-t-[10px] bg-card border border-ink border-b-0 shadow-[0_-10px_30px_rgba(24,39,58,0.18)] px-4 pb-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
        <div className="sticky top-0 z-10 bg-card -mx-4 px-4 touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {/* Zeigertippen erledigt onUp (Zeiger ist eingefangen); onClick nur für Tastatur (detail 0). */}
          <button type="button" data-grip aria-label="Blatt schließen (oder nach unten ziehen)" onClick={(e) => e.detail === 0 && onClose()} className="flex items-center justify-center mx-auto h-11 w-28 cursor-grab">
            <span className="block h-1 w-10 rounded-full bg-rule" />
          </button>
          <div className="flex items-center gap-3 mb-3 pb-3 border-b-[3px] border-double border-ink">
            {icon}
            <h2 className="font-serif text-xl flex-1 min-w-0">{title}</h2>
            <button type="button" data-close className="tap rounded-lg border border-rule text-ink2 text-base" onClick={onClose} aria-label="Schließen">✕</button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatTable({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink2 py-1 border-b border-dotted border-rule">{k}</dt>
          <dd className="text-right mono py-1 border-b border-dotted border-rule">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Fortschrittsbalken mit Streifen, solange er läuft. */
export function Bar({ value, tone = "sea" }: { value: number; tone?: "sea" | "brass" | "red" | "green" }) {
  const color = { sea: "bg-ink", brass: "bg-messing", red: "bg-siegel", green: "bg-moos" }[tone];
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="h-[5px] w-full bg-rule/70 overflow-hidden rounded-full">
      <div className={`h-full ${color} ${v > 0 && v < 1 ? "stripes" : ""}`} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "brass" | "green" | "red" | "sea" }) {
  const c = {
    slate: "border-rule text-ink2",
    brass: "border-messing text-messing",
    green: "border-moos text-moos",
    red: "border-siegel text-siegel",
    sea: "border-see text-see",
  }[tone];
  return <span className={`inline-flex items-center border bg-card px-1.5 py-0.5 rounded-[2px] text-[10.5px] font-display uppercase tracking-[0.08em] ${c}`}>{children}</span>;
}

/** Ressourcen als Symbol und Zahl. */
export function ResChips({ values, empty = "–" }: { values: Record<string, number> | null | undefined; empty?: string }) {
  const parts = Object.entries(values ?? {}).filter(([, v]) => v > 0);
  if (parts.length === 0) return <span className="text-slate-400">{empty}</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
      {parts.map(([r, v]) => (
        <span key={r} className="inline-flex items-center gap-1 mono"><Icon id={r} size={18} /> {fmtNum(v)}</span>
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
        <span key={id} className="inline-flex items-center gap-1" title={label(id)}><Icon id={id} size={22} /> <span className="mono">{fmtNum(n)}</span> <span className="text-ink2 text-xs">{countLabel(id, n)}</span></span>
      ))}
    </span>
  );
}

const ACTION_BAR_HOST = "tf-actionbar";

/**
 * Platz der Aktionsleiste: letztes Kind des gemeinsamen <main> (App.tsx), sticky am unteren Rand über der
 * Navigation. -mx-3 für volle Breite, -bottom-8 gleicht das Polster (pb-8) aus; leer unsichtbar.
 * Die Navigation darunter trägt bereits den Safe-Area-Abstand.
 */
export function ActionBarHost() {
  return <div id={ACTION_BAR_HOST} className="sticky -bottom-8 z-20 -mx-3 mt-3 empty:hidden" />;
}

/**
 * Fixierte Aktionsleiste (Auslaufen, Order, Angebot einstellen): bleibt beim Scrollen sichtbar, auch wenn die
 * Komponente tief in einer Karte steckt – sie wird per Portal in ActionBarHost gezeichnet. Je Ansicht höchstens eine.
 * Ohne Platz (z. B. außerhalb von <main>) erscheint sie an Ort und Stelle.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setHost(document.getElementById(ACTION_BAR_HOST)), []);
  const bar = <div className="px-3 py-2 bg-paper border-t-[3px] border-double border-ink">{children}</div>;
  return host ? createPortal(bar, host) : <div className="mt-3">{bar}</div>;
}
