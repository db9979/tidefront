// Scrollposition je Ansicht: Alle Reiter teilen sich ein <main>. Ohne Merker öffnete ein Wechsel „irgendwo unten“
// (die Position des vorigen Reiters). Hier wird scrollTop je Ansichtsschlüssel gemerkt und beim Wechsel
// wiederhergestellt; Ansichten in ALWAYS_TOP (Planung, Handbuch, Forschung) beginnen immer oben.
import { useCallback, useLayoutEffect, useRef } from "react";

const ALWAYS_TOP = new Set(["planung", "handbuch", "forschung"]);
/** Nachgeladene Ansichten (lazy, Abfragen) wachsen erst später: so lange versuchen wir, die Position zu erreichen. */
const RESTORE_MS = 1200;

/** Liefert ref und onScroll für das gemeinsame <main>; key = Reiter (+ Unterreiter). */
export function useViewScroll(key: string) {
  const ref = useRef<HTMLElement>(null);
  const saved = useRef(new Map<string, number>());
  const current = useRef(key);
  const restoring = useRef(false);

  // Laufend mitschreiben, damit beim Wechsel die letzte Position des alten Reiters vorliegt.
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el && !restoring.current) saved.current.set(current.current, el.scrollTop);
  }, []);

  // Zusätzlich vor jedem Klick/Tastendruck/Zurück (Capture, also vor React): Scroll-Ereignisse kommen erst im
  // nächsten Frame und fehlen in Hintergrund-Tabs; der Wechsel selbst darf die alte Position nicht verlieren.
  useLayoutEffect(() => {
    const evs = ["click", "keydown", "popstate"] as const;
    for (const e of evs) window.addEventListener(e, onScroll, true);
    return () => { for (const e of evs) window.removeEventListener(e, onScroll, true); };
  }, [onScroll]);

  useLayoutEffect(() => {
    const el = ref.current;
    current.current = key;
    if (!el) return;
    const want = ALWAYS_TOP.has(key) ? 0 : saved.current.get(key) ?? 0;
    el.scrollTop = want;
    if (want === 0 || Math.abs(el.scrollTop - want) <= 1) return;
    // Inhalt noch zu kurz (Lädt …): bis er hoch genug ist erneut setzen; Abbruch, sobald der Nutzer selbst rollt.
    const until = performance.now() + RESTORE_MS;
    let raf = 0;
    const stop = () => { restoring.current = false; cancelAnimationFrame(raf); };
    restoring.current = true;
    el.addEventListener("wheel", stop, { passive: true });
    el.addEventListener("touchstart", stop, { passive: true });
    const tick = () => {
      if (!restoring.current) return;
      el.scrollTop = want;
      if (Math.abs(el.scrollTop - want) > 1 && performance.now() < until) raf = requestAnimationFrame(tick);
      else { restoring.current = false; saved.current.set(key, el.scrollTop); }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stop();
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
    };
  }, [key]);

  return { ref, onScroll };
}
