// Hauptnavigation: fünf Reiter, mobil als Leiste unten, am Desktop (ab 1024 px) als Leiste links.
// Eine Zahl je Reiter (UI-02/UI-17): Basis = neue dringende Einträge der Lage (inkl. abholbereiter Belohnungen;
// rot pulsierend bei Angriff), Meldungen = ungelesene Berichte und Nachrichten. Die Bedeutung steht im aria-label
// des Knopfs (UI-18), nicht nur im title.
import type { ReactNode } from "react";
import { Icon } from "../icons.tsx";

export type Tab = "basis" | "karte" | "truppen" | "berichte" | "boerse";

export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "basis", label: "Basis", icon: "nav-basis" },
  { id: "karte", label: "Karte", icon: "nav-karte" },
  { id: "truppen", label: "Truppen", icon: "nav-truppen" },
  { id: "berichte", label: "Meldungen", icon: "nav-bericht" },
  { id: "boerse", label: "Börse", icon: "nav-boerse" },
];

export interface NavBadges {
  /** Basis: neue dringende Lage-Einträge (inkl. abholbereiter Belohnungen). */
  lage: number;
  /** Basis: Angriff im Anmarsch (rote Zahl bzw. Raute, pulsierend). */
  attack: boolean;
  /** Meldungen: ungelesene Berichte und Nachrichten. */
  unread: number;
}

/** Zahl und Bedeutung je Reiter; null = kein Abzeichen. */
export function badgeOf(id: Tab, b: NavBadges): { n: number | null; text: string; alarm: boolean } | null {
  if (id === "basis") {
    if (b.lage > 0) return { n: b.lage, alarm: b.attack, text: `${b.lage} ${b.lage === 1 ? "Eintrag wartet" : "Einträge warten"} in der Lage${b.attack ? ", Angriff im Anmarsch" : ""}` };
    if (b.attack) return { n: null, alarm: true, text: "Angriff im Anmarsch" };
    return null;
  }
  if (id === "berichte" && b.unread > 0) return { n: b.unread, alarm: false, text: `${b.unread} ungelesen` };
  return null;
}

// Desktop (UX-0.43 B4): „Karte“ ist in der Leiste der Umschalter „Karte groß“ (mapBig = gedrückt), footer steht unten
// in der Leiste (Saison, Handbuch, Einstellungen, Verwaltung). Kürzel 1–5 (aria-keyshortcuts, lib/shortcuts.ts).
export function NavBar({ tab, active, rail, badges, onPick, mapBig, footer }: { tab: Tab; active: boolean; rail: boolean; badges: NavBadges; onPick: (t: Tab) => void; mapBig?: boolean; footer?: ReactNode }) {
  return (
    <nav
      aria-label="Hauptnavigation"
      data-testid={rail ? "nav-rail" : "nav-bottom"}
      className={rail
        ? "w-[96px] shrink-0 flex flex-col gap-1 pt-2 bg-paper border-r-[3px] border-double border-ink"
        : "grid grid-cols-5 bg-paper border-t-[3px] border-double border-ink"}
      style={rail ? undefined : { paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((t, i) => {
        const toggle = rail && t.id === "karte";
        const on = toggle ? !!mapBig : tab === t.id && active && !mapBig;
        const name = toggle ? "Karte groß" : t.label;
        const badge = badgeOf(t.id, badges);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            aria-label={badge ? `${name}, ${badge.text}` : name}
            title={rail ? `${badge ? `${name} – ${badge.text}` : name} (Taste ${i + 1})` : badge?.text}
            aria-keyshortcuts={String(i + 1)}
            className={`tap relative flex flex-col items-center justify-center text-[11px] leading-tight ${rail ? "py-2.5" : "pt-1.5 pb-1"} ${on ? "text-ink font-semibold" : "text-ink2"}`}
            aria-current={on && !toggle ? "page" : undefined}
            aria-pressed={toggle ? on : undefined}
          >
            {on && <span className={rail ? "absolute -right-[3px] inset-y-[18%] w-[3px] bg-siegel" : "absolute -top-[3px] inset-x-[22%] h-[3px] bg-siegel"} />}
            <Icon id={t.icon} size={24} />
            <span className="mt-0.5 whitespace-nowrap">{name}</span>
            {badge && (badge.n !== null ? (
              <span data-testid={`nav-badge-${t.id}`} aria-hidden="true"
                className={`absolute top-1 right-[18%] min-w-5 h-5 px-1 rounded-full ${badge.alarm ? "bg-siegel pulse" : t.id === "basis" ? "bg-messing" : "bg-siegel"} text-white text-[11px] mono grid place-items-center`}>{badge.n}</span>
            ) : (
              <span data-testid={`nav-badge-${t.id}`} aria-hidden="true" className="absolute top-1.5 right-[24%] w-3 h-3 rotate-45 bg-siegel pulse" />
            ))}
          </button>
        );
      })}
      {rail && footer}
    </nav>
  );
}
