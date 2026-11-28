// Tastaturkürzel (UX-0.43 N-5/B4): 1–5 wählen die Hauptreiter, A holt alle Belohnungen ab (Knopf „Alle abholen“
// der Lage, falls sichtbar), ? öffnet das Handbuch, , die Einstellungen, M die Karte groß bzw. zurück.
// Esc schließt Blätter (Sheet in ui.tsx) und Ansichten wie Handbuch/Einstellungen/Verwaltung.
// Kürzel greifen nie beim Tippen in Eingabefeldern, nie mit Strg/Alt/Cmd und nicht, solange ein Dialog offen ist.
import { useEffect, useRef } from "react";

export const SHORTCUTS: { keys: string; text: string }[] = [
  { keys: "1 – 5", text: "Basis, Karte, Truppen, Meldungen, Börse" },
  { keys: "A", text: "Alle abholen (Lage)" },
  { keys: "M", text: "Karte groß ein/aus (breiter Bildschirm)" },
  { keys: "?", text: "Handbuch" },
  { keys: ",", text: "Einstellungen" },
  { keys: "Esc", text: "Blatt oder Ansicht schließen" },
];

export interface ShortcutHandlers {
  tab: (index: number) => void;
  handbook: () => void;
  settings: () => void;
  mapToggle: () => void;
  /** Esc ohne offenes Blatt: offene Ansicht schließen; false = nichts zu schließen. */
  escape: () => boolean;
}

/** Tippt der Spieler gerade Text (oder steht der Fokus in einer Auswahl)? */
export function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(type);
  }
  return tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/** Knopf „Alle abholen“ im sichtbaren Inhalt (Lage), nicht deaktiviert. */
function claimAllButton(): HTMLButtonElement | null {
  const list = document.querySelectorAll<HTMLButtonElement>("main button");
  for (const b of list) if (!b.disabled && /^Alle abholen/.test(b.textContent?.trim() ?? "")) return b;
  return null;
}

export function useShortcuts(enabled: boolean, h: ShortcutHandlers) {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(document.activeElement)) return;
      const dialog = document.querySelector("[role=dialog][aria-modal=true]");
      if (e.key === "Escape") {
        if (!dialog && ref.current.escape()) e.preventDefault(); // offenes Blatt schließt das Blatt selbst
        return;
      }
      if (dialog) return;
      const k = e.key;
      if (k >= "1" && k <= "5") { ref.current.tab(Number(k) - 1); e.preventDefault(); return; }
      if (k === "a" || k === "A") { const b = claimAllButton(); if (b) { b.click(); e.preventDefault(); } return; }
      if (k === "m" || k === "M") { ref.current.mapToggle(); e.preventDefault(); return; }
      if (k === "?") { ref.current.handbook(); e.preventDefault(); return; }
      if (k === ",") { ref.current.settings(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
