// Breite Fenster (ab 1024 px, Tailwind lg): Desktop-Layout mit Navigationsleiste links, Karte in der Mitte und
// Seitenleiste rechts (App.tsx). Darunter bleibt die Handyspalte mit Navigation unten.
import { useEffect, useState } from "react";

export const DESKTOP_QUERY = "(min-width: 1024px)";

function matches(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;
}

/** true, solange das Fenster mindestens 1024 px breit ist (reagiert auf Größenänderung und Drehen). */
export function useDesktop(): boolean {
  const [desk, setDesk] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desk;
}
