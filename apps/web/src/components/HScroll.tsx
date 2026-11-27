// Seitlich schiebbare Leiste (Reiter, Filter, Kapitel): nur waagerecht scrollbar (kein Wackeln nach oben/unten),
// und sichtbar, dass es weitergeht: Verlauf mit Pfeil links/rechts, sobald dort weitere Einträge liegen.
// Ein Tipp auf den Pfeil schiebt um gut eine halbe Breite. Der gewählte Eintrag (aria-selected/aria-checked/
// aria-current) wird beim Wechsel in den sichtbaren Bereich geholt.
import { useEffect, useRef, useState, type ReactNode } from "react";

export function HScroll({ children, className = "", label, role, fade = "from-paper", watch }: {
  children: ReactNode;
  /** Klassen der inneren Leiste (gap, padding …). */
  className?: string;
  label?: string;
  role?: string;
  /** Tailwind-Farbe des Verlaufs (Hintergrund der Leiste), z. B. "from-paper" oder "from-navy-800". */
  fade?: string;
  /** Wert, bei dessen Änderung der gewählte Eintrag sichtbar gemacht wird. */
  watch?: unknown;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = () => {
    const el = bar.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  };
  useEffect(() => {
    const el = bar.current;
    el?.querySelector<HTMLElement>("[aria-selected='true'],[aria-checked='true'],[aria-current='true']")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (el && ro) { ro.observe(el); for (const c of Array.from(el.children)) ro.observe(c); }
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [watch]);
  const step = (dir: 1 | -1) => {
    const el = bar.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };
  const arrow = "absolute inset-y-0 w-11 flex items-center";
  const chip = "w-6 h-6 rounded-full bg-ink text-paper text-[15px] leading-none grid place-items-center shadow-sm pb-px";
  return (
    <div className="relative">
      <div ref={bar} onScroll={measure} role={role} aria-label={label}
        className={`flex overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
        {children}
      </div>
      {more.left && (
        <button type="button" tabIndex={-1} aria-hidden onClick={() => step(-1)} className={`${arrow} left-0 justify-start pl-1 bg-linear-to-r ${fade} from-40% to-transparent`}><span className={chip}>‹</span></button>
      )}
      {more.right && (
        <button type="button" tabIndex={-1} aria-hidden onClick={() => step(1)} className={`${arrow} right-0 justify-end pr-1 bg-linear-to-l ${fade} from-40% to-transparent`}><span className={chip}>›</span></button>
      )}
    </div>
  );
}
