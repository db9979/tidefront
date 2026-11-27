// Menü der Kopfleiste (ersetzt den „?“-Knopf): Handbuch, Einstellungen, Verwaltung (nur Admins), Abmelden.
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { Icon } from "../icons.tsx";
import { Sheet } from "../ui.tsx";

export type MenuItem = "handbuch" | "settings" | "admin" | "logout";

function Row({ icon, mark, title, hint, onClick, danger }: { icon?: string; mark?: string; title: string; hint: string; onClick: () => void; danger?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="tap w-full flex items-center gap-3 py-2.5 text-left">
        <span aria-hidden className={`shrink-0 w-9 h-9 rounded-lg border grid place-items-center font-serif text-lg ${danger ? "border-siegel text-siegel" : "border-rule text-ink"}`}>
          {icon ? <Icon id={icon} size={24} /> : mark}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block font-serif text-[17px] leading-tight ${danger ? "text-siegel" : ""}`}>{title}</span>
          <span className="block text-xs text-ink2">{hint}</span>
        </span>
        <span aria-hidden className="text-ink2">›</span>
      </button>
    </li>
  );
}

export function MenuSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (i: MenuItem) => void }) {
  const me = useQuery({ ...trpc.auth.me.queryOptions(), enabled: open });
  const player = me.data?.player;
  return (
    <Sheet open={open} onClose={onClose} title="Menü">
      <ul className="divide-y divide-rule" aria-label="Menü">
        <Row mark="?" title="Handbuch" hint="Regeln, Kapitel, Neuigkeiten, Fehler melden" onClick={() => onPick("handbuch")} />
        <Row icon="zahnrad" title="Einstellungen" hint="Benachrichtigungen, E-Mail, Kurszeile, Passwort" onClick={() => onPick("settings")} />
        {player?.isAdmin && <Row mark="§" title="Verwaltung" hint="Kennzahlen, KI-Spieler, Einladungen, Sicherungen" onClick={() => onPick("admin")} />}
        <Row mark="⏻" title="Abmelden" hint={player ? `Angemeldet als ${player.name}` : "Vom Gerät abmelden"} onClick={() => onPick("logout")} danger />
      </ul>
    </Sheet>
  );
}
