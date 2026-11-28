// Einstellungen (UX-0.43 A6/B2): eigene Ansicht neben Handbuch und Verwaltung (App.tsx), vier Gruppen –
// Benachrichtigungen (Push, Ruhezeit, E-Mail-Arten, Morgenbericht), Spiel (Nachtschild-Startzeit, Kurszeile),
// Konto (Name, E-Mail-Adresse, Passwort, Abmelden), Hilfe (Handbuch, Neuigkeiten, Fehler melden, Tastaturkürzel).
// Querverweise nur als Textlinks; Freunde einladen, Fehler melden und Verwaltung haben ihren Ort im Menü.
// Am Desktop zwei Spalten (Benachrichtigungen links, der Rest rechts).
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { useNav } from "../lib/nav.ts";
import { useNow } from "../lib/time.ts";
import { requestBugReport } from "../lib/bug-log.ts";
import { SHORTCUTS } from "../lib/shortcuts.ts";
import { BackButton, Card, FilterChips } from "../ui.tsx";
import { setTickerPos, useTickerPos, type TickerPos } from "../components/market/TickerBar.tsx";
import { SummaryCard } from "../components/MorningSummary.tsx";
import { NightShieldSetting } from "../components/NightShieldSetting.tsx";
import { EmailNotifyCard, PushCard, QuietCard } from "../components/settings/NotifyCards.tsx";
import { EmailCard, PasswordCard } from "../components/settings/AccountCards.tsx";
import { ChangelogSheet, VersionLine } from "../components/Changelog.tsx";

export type SettingsFocus = "push";
type Group = "benachrichtigungen" | "spiel" | "konto" | "hilfe";
const GROUPS: { id: Group; label: string }[] = [
  { id: "benachrichtigungen", label: "Benachrichtigungen" },
  { id: "spiel", label: "Spiel" },
  { id: "konto", label: "Konto" },
  { id: "hilfe", label: "Hilfe" },
];

const link = "tap underline text-see text-left";

function GroupBox({ id, title, children }: { id: Group; title: string; children: ReactNode }) {
  return (
    <section id={`einstellungen-${id}`} aria-labelledby={`einstellungen-${id}-h`} className="scroll-mt-4 min-w-0">
      <h2 id={`einstellungen-${id}-h`} className="font-serif text-xl mb-2 pb-1 border-b-[3px] border-double border-ink">{title}</h2>
      {children}
    </section>
  );
}

function TickerChoice() {
  const pos = useTickerPos();
  const items: { id: TickerPos; label: string }[] = [{ id: "aus", label: "Nur in der Börse" }, { id: "oben", label: "Immer oben" }, { id: "unten", label: "Immer unten" }];
  return <FilterChips label="Börsen-Kurszeile" value={pos} onChange={setTickerPos} items={items} className="mb-0" />;
}

function GameGroup() {
  const nav = useNav();
  const now = useNow(60000);
  return (
    <GroupBox id="spiel" title="Spiel">
      <Card title="Nachtschild">
        {nav.base ? <NightShieldSetting base={nav.base} now={now} id="tf-night-settings" /> : <p className="text-sm text-ink2">Erst einen Hafen gründen.</p>}
      </Card>
      <Card title="Börsen-Kurszeile">
        <p className="text-sm text-slate-300 mb-2">Laufende Kurse auf allen Bildschirmen – antippen öffnet die Börse.</p>
        <TickerChoice />
      </Card>
    </GroupBox>
  );
}

function HelpGroup({ onHandbook }: { onHandbook: () => void }) {
  const [news, setNews] = useState(false);
  return (
    <GroupBox id="hilfe" title="Hilfe">
      <Card title="Hilfe und Rückmeldung">
        <ul className="text-sm space-y-2">
          <li><button type="button" className={link} onClick={onHandbook}>Handbuch öffnen</button> – Regeln und Kapitel</li>
          <li><button type="button" className={link} onClick={() => setNews(true)}>Was ist neu?</button> – Änderungen je Version</li>
          <li><button type="button" className={link} onClick={requestBugReport}>Fehler melden</button> – mit Screenshot (auch im Menü)</li>
        </ul>
      </Card>
      <Card title="Tastaturkürzel" collapsible storageKey="einstellungen-kuerzel" defaultOpen={false} summary="1–5 Reiter, A abholen, Esc schließen …">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" data-testid="shortcut-list">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="contents"><dt><kbd className="mono text-xs border border-rule rounded px-1.5 py-0.5 bg-card whitespace-nowrap">{s.keys}</kbd></dt><dd>{s.text}</dd></div>
          ))}
        </dl>
      </Card>
      <VersionLine onOpen={() => setNews(true)} />
      <ChangelogSheet open={news} onClose={() => setNews(false)} />
    </GroupBox>
  );
}

export function SettingsScreen({ onClose, onHandbook, onLogout, focus }: { onClose: () => void; onHandbook: () => void; onLogout: () => void; focus?: SettingsFocus | null }) {
  const me = useQuery(trpc.auth.me.queryOptions());
  const player = me.data?.player;
  const isAdmin = !!player?.isAdmin;
  const [group, setGroup] = useState<Group | null>(null);
  const jump = (g: Group) => {
    setGroup(g);
    document.getElementById(`einstellungen-${g}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };
  // Aus der Push-Frage im Spielablauf: direkt zur Push-Karte.
  useEffect(() => {
    if (focus === "push") setTimeout(() => document.getElementById("einstellungen-push")?.scrollIntoView?.({ block: "start" }), 0);
  }, [focus]);
  return (
    <div data-testid="settings-screen">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display text-2xl font-bold uppercase">Einstellungen</h1>
        <BackButton onClick={onClose} />
      </div>
      <FilterChips label="Gruppen der Einstellungen" value={group} onChange={jump} items={GROUPS} className="lg:hidden" />
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start space-y-5 lg:space-y-0">
        <GroupBox id="benachrichtigungen" title="Benachrichtigungen">
          <PushCard isAdmin={isAdmin} />
          <QuietCard />
          <SummaryCard />
          <EmailNotifyCard isAdmin={isAdmin} />
        </GroupBox>
        <div className="space-y-5 min-w-0">
          <GameGroup />
          <GroupBox id="konto" title="Konto">
            <Card title="Angemeldet">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 break-words">als <strong>{player?.name ?? "…"}</strong>{isAdmin ? " (Admin)" : ""}</span>
                <button type="button" className={link} onClick={onLogout}>Abmelden</button>
              </div>
            </Card>
            <EmailCard />
            <PasswordCard />
          </GroupBox>
          <HelpGroup onHandbook={onHandbook} />
        </div>
      </div>
    </div>
  );
}
