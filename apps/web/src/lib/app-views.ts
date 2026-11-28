// Gleichrangige Ansichten der App-Hülle (UX-0.43 B2): Handbuch, Einstellungen, Verwaltung. Früher steckten
// Einstellungen und Verwaltung im Handbuch, „Zurück“ aus den Einstellungen landete im Handbuch. Jetzt:
// – aus dem Menü (oder per Kürzel/Benachrichtigung) geöffnet, ersetzt eine Ansicht die offene; „Zurück“ führt zum
//   Ausgangsort (dem Reiter darunter);
// – über einen Querverweis (Textlink, z. B. Handbuch → Einstellungen) geöffnet, liegt sie eine Ebene darüber und
//   „Zurück“ führt zur verweisenden Ansicht. Höchstens zwei Ebenen.
// Die Zurück-Taste (Browser/Handy) schließt dieselben Ebenen (lib/back.ts).
import { useState } from "react";
import { useBackLayer } from "./back.ts";

export type ViewId = "handbuch" | "settings" | "admin";
export interface OpenView { id: ViewId; /** Einstellungen: zu einem Abschnitt springen (z. B. Push). */ focus?: "push" | null }

/** Ist ein Meldungen-Unterreiter Teil der Saison (Rangliste, Bilanz, Erfolge)? Am Desktop eine Textansicht. */
export function isSaisonSub(sub: string): boolean {
  return sub === "saison" || sub === "rangliste" || sub === "bilanz" || sub === "erfolge";
}

export function useAppViews(initial: ViewId | null) {
  const [stack, setStack] = useState<OpenView[]>(initial ? [{ id: initial }] : []);
  useBackLayer(stack.length >= 1, () => setStack([]), 1);
  useBackLayer(stack.length >= 2, () => setStack((s) => s.slice(0, 1)), 2);
  return {
    top: stack[stack.length - 1] ?? null,
    depth: stack.length,
    /** cross: Querverweis aus der offenen Ansicht (Zurück führt dorthin); sonst ersetzt sie alles. */
    open: (v: OpenView, cross = false) => setStack((s) => (cross && s.length ? [s[s.length - 1], v] : s.length === 1 && s[0].id === v.id && !v.focus ? s : [v])),
    back: () => setStack((s) => s.slice(0, -1)),
    closeAll: () => setStack([]),
  };
}
