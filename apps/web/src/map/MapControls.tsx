// Bedienleiste der Karte (nach 0.46): eine schmale Spalte rechts oben aus gleich großen Symbolknöpfen (44 × 44 px),
// in Gruppen mit gemeinsamem Rahmen – Zoom (+/−) und die Knöpfe des Bildschirms (Mein Hafen, Sichtungen, Ebenen).
// Jeder Knopf trägt einen zugänglichen Namen (aria-label) und einen Tooltip (title). Eigene Datei ohne Pixi.
import type { ReactNode } from "react";
import { Icon } from "../icons.tsx";

/** Gemeinsamer Rahmen einer Knopfgruppe (Knöpfe durch feine Linien getrennt). */
const GROUP = "flex flex-col rounded-[3px] border border-ink bg-card/95 shadow-sm divide-y divide-rule overflow-hidden";

/** Gemeinsamer Rahmen der Kärtchen links oben (Wetter), passend zur Leiste. */
export const MAP_CHIP = "min-h-11 rounded-[3px] bg-card/95 border shadow-sm";

/** Abstand zum Kartenrand, im Querformat mit Notch außerhalb des sicheren Bereichs. */
export const SAFE_RIGHT = { right: "max(0.5rem, env(safe-area-inset-right))" } as const;
export const SAFE_LEFT = { left: "max(0.5rem, env(safe-area-inset-left))" } as const;

export function MapButton({ icon, label, title, onClick, testId, dialog }: {
  /** Symbol-ID aus dem Symbolsatz (icons-art.tsx) oder eigenes Element. */
  icon: string | ReactNode; label: string; title?: string; onClick: () => void; testId?: string;
  /** Öffnet ein Blatt (aria-haspopup="dialog"). */
  dialog?: boolean;
}) {
  return (
    <button
      type="button"
      className="w-11 h-11 grid place-items-center text-ink hover:bg-paper active:bg-rule/60 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink"
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      aria-haspopup={dialog ? "dialog" : undefined}
      data-testid={testId}
    >
      {typeof icon === "string" ? <Icon id={icon} size={22} /> : icon}
    </button>
  );
}

/** Die Leiste: Zoom-Gruppe, darunter (falls vorhanden) die Gruppe des Bildschirms. */
export function MapToolbar({ onZoom, children }: { onZoom: (factor: number) => void; children?: ReactNode }) {
  return (
    <div role="toolbar" aria-label="Kartensteuerung" aria-orientation="vertical" className="absolute top-2 flex flex-col gap-2" style={SAFE_RIGHT}>
      <div role="group" aria-label="Zoom" className={GROUP}>
        <MapButton icon="karte-plus" label="Hineinzoomen" onClick={() => onZoom(1.5)} />
        <MapButton icon="karte-minus" label="Herauszoomen" onClick={() => onZoom(1 / 1.5)} />
      </div>
      {children && <div role="group" aria-label="Ansicht" className={GROUP}>{children}</div>}
    </div>
  );
}
