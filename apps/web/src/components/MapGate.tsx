// Eingebettete Karte (z. B. Missionsplanung): Die Karte fängt Wischgesten selbst (touch-action: none) und würde das
// Rollen der Seite blockieren. Darum liegt zunächst eine Deckfläche darüber: Wischen rollt die Seite, Antippen
// schaltet die Karte frei („Karte bedienen“). „Fertig“ legt die Deckfläche wieder auf.
import { useState, type ReactNode } from "react";

export function MapGate({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className={`relative ${className}`} data-testid="plan-map" data-active={on || undefined}>
      {children}
      {!on ? (
        <button type="button" onClick={() => setOn(true)} aria-label="Karte bedienen"
          className="absolute inset-0 z-10 flex items-end justify-center pb-3 bg-ink/[0.04]">
          <span className="rounded-lg px-3 py-2 btn-primary font-display uppercase text-[12px] tracking-[0.1em] shadow-md">Karte bedienen</span>
        </button>
      ) : (
        <button type="button" onClick={() => setOn(false)}
          className="tap absolute top-2 right-2 z-10 rounded-lg px-3 btn-quiet shadow-md font-display uppercase text-[11px] tracking-[0.1em]">
          Fertig
        </button>
      )}
    </div>
  );
}
