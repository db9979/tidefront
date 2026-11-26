// Zurück-Taste (Handy, Browser): jede offene Ebene (Ansicht, Unteransicht, Blatt) hat einen Verlaufseintrag;
// Zurück schließt die oberste Ebene statt die App zu verlassen. Schließt der Spieler per Knopf, wird der
// überzählige Eintrag wieder entfernt. Ebenen sind nach level sortiert (App-Ansicht 1, Unteransicht 2,
// Verwaltung 3, Blatt 5), damit die Reihenfolge auch beim gleichzeitigen Öffnen (Direktlink) stimmt.
import { useEffect, useRef } from "react";

interface Layer { level: number; close: () => void }

const stack: Layer[] = [];
const depthOf = (s: unknown): number => {
  const d = (s as { tfLayer?: unknown } | null)?.tfLayer;
  return typeof d === "number" ? d : 0;
};

// Nach Neuladen trägt der aktuelle Eintrag noch die Tiefe von vorher, offen ist aber nichts mehr.
if (typeof history !== "undefined" && depthOf(history.state) > 0) {
  history.replaceState({ ...(history.state as object), tfLayer: 0 }, "", location.href);
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", (e) => {
    const d = depthOf(e.state);
    // Oberste zuerst schließen; aus dem Stapel nehmen, bevor close() Komponenten abbaut.
    while (stack.length > d) stack.pop()!.close();
  });
}

let syncQueued = false;
/** Überzählige Verlaufseinträge (per Knopf geschlossene Ebenen) entfernen, gesammelt nach allen Abbauten. */
function sync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    const cur = depthOf(history.state);
    if (cur > stack.length) history.go(stack.length - cur);
  });
}

function pushLayer(layer: Layer): () => void {
  listen();
  let i = stack.length;
  while (i > 0 && stack[i - 1].level > layer.level) i--;
  stack.splice(i, 0, layer);
  const depth = stack.length;
  // Noch nicht entfernter Eintrag einer eben geschlossenen Ebene: wiederverwenden statt stapeln.
  if (depthOf(history.state) >= depth) history.replaceState({ ...(history.state ?? {}), tfLayer: depth }, "", location.href);
  else history.pushState({ tfLayer: depth }, "", location.href);
  return () => {
    const at = stack.indexOf(layer);
    if (at < 0) return; // schon per Zurück geschlossen
    stack.splice(at, 1);
    sync();
  };
}

/** Solange open, schließt die Zurück-Taste diese Ebene über close. */
export function useBackLayer(open: boolean, close: () => void, level: number) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open) return;
    return pushLayer({ level, close: () => ref.current() });
  }, [open, level]);
}
