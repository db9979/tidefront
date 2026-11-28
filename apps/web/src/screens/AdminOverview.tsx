// Verwaltung → Übersicht (UX-0.43 B3): Ampel mit Handlungsbedarf (Systemzustand, offene Fehlermeldungen,
// fehlgeschlagene Ereignisse, Sicherung, E-Mail) – jede Zeile springt zum Abschnitt –, darunter Fehlermeldungen und
// Ereignisse. Selten Gebrauchtes (E-Mail-Versand, Sicherungen, Systemwerte) liegt eingeklappt unter „Einrichtung“.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { Card, ErrorLine, Loading, StatTable } from "../ui.tsx";
import { AdminBugReports } from "./AdminBugReports.tsx";
import { AdminEvents } from "./AdminEvents.tsx"; // Ereignis-Queue: fehlgeschlagene Ereignisse
import { AdminMail } from "./AdminMail.tsx";
import { AdminBackups } from "./AdminBackups.tsx";
import { when } from "./AdminPlayers.tsx";

type Tone = "red" | "brass" | "green";
interface Light { key: string; label: string; text: string; tone: Tone; target: string; setup?: boolean }

const DOT: Record<Tone, string> = { red: "bg-siegel", brass: "bg-messing", green: "bg-moos" };
const WORD: Record<Tone, string> = { red: "Handeln", brass: "Prüfen", green: "in Ordnung" };

export function AdminOverview() {
  const q = useQuery({ ...trpc.admin.overview.queryOptions(), refetchInterval: 30000 });
  const bugs = useQuery({ ...trpc.bugReport.list.queryOptions(), refetchInterval: 60000 });
  const [setup, setSetup] = useState(false);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorLine text="Keine Berechtigung oder Server nicht erreichbar." />;
  const s = q.data.status;
  const openBugs = (bugs.data?.reports ?? []).filter((r) => r.status === "offen").length;
  const mailReady = bugs.data?.mailReady ?? !!s.mail.lastSentAt;

  const lights: Light[] = [
    {
      key: "system", label: "Systemzustand", target: "admin-system", setup: true,
      tone: s.problems.length ? "red" : s.backlog.count ? "brass" : "green",
      text: s.problems.length ? s.problems.map((p) => p.text).join(" · ") : s.backlog.count ? `Rückstau ${s.backlog.count}, ältestes ${Math.round(s.backlog.oldestOverdueSec / 60)} Min.` : "läuft",
    },
    { key: "bugs", label: "Fehlermeldungen", target: "admin-fehler", tone: openBugs ? "red" : "green", text: openBugs ? `${openBugs} offen` : "nichts offen" },
    { key: "events", label: "Fehlgeschlagene Ereignisse", target: "admin-ereignisse", tone: s.failed.count ? "red" : "green", text: s.failed.count ? `${s.failed.count} – neu einreihen oder prüfen` : "keine" },
    {
      key: "backup", label: "Sicherung", target: "admin-sicherungen", setup: true,
      tone: !s.backup ? "brass" : s.backup.ageHours > 36 ? "brass" : "green",
      text: s.backup ? `zuletzt ${when(s.backup.at)} (${Math.round(s.backup.ageHours)} h)` : "noch keine erfasst – „Jetzt sichern“",
    },
    {
      key: "mail", label: "E-Mail", target: "admin-mail", setup: true,
      tone: s.mail.lastError && (!s.mail.lastSentAt || new Date(s.mail.lastError.at) > new Date(s.mail.lastSentAt)) ? "red" : mailReady ? "green" : "brass",
      text: s.mail.lastError ? `letzter Fehler ${when(s.mail.lastError.at)}` : mailReady ? (s.mail.lastSentAt ? `zuletzt gesendet ${when(s.mail.lastSentAt)}` : "eingerichtet") : "nicht eingerichtet",
    },
  ];
  const todo = lights.filter((l) => l.tone !== "green");
  const ok = lights.filter((l) => l.tone === "green");
  const jump = (l: Light) => {
    if (l.setup) setSetup(true);
    setTimeout(() => document.getElementById(l.target)?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 0);
  };

  return (
    <div>
      <Card title="Ampel">
        {todo.length === 0 ? <p className="text-sm text-moos font-semibold mb-1">Alles in Ordnung.</p> : (
          <ul className="divide-y divide-rule mb-2" data-testid="admin-ampel">
            {todo.map((l) => (
              <li key={l.key}>
                <button type="button" className="tap w-full flex items-start gap-2 py-2 text-left" onClick={() => jump(l)}>
                  <span aria-hidden className={`shrink-0 mt-1.5 w-3 h-3 rounded-full ${DOT[l.tone]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{l.label} <span className="sr-only">({WORD[l.tone]})</span></span>
                    <span className="block text-xs text-ink2 break-words">{l.text}</span>
                  </span>
                  <span aria-hidden className="text-ink2">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {ok.length > 0 && <p className="text-xs text-ink2"><span aria-hidden className={`inline-block w-2 h-2 rounded-full mr-1 ${DOT.green}`} />In Ordnung: {ok.map((l) => l.label).join(", ")}</p>}
      </Card>
      <div className="lg:grid lg:grid-cols-2 lg:gap-x-4 lg:items-start">
        <div className="min-w-0" id="admin-fehler"><AdminBugReports /></div>
        <div className="min-w-0" id="admin-ereignisse"><AdminEvents /></div>
      </div>
      <section className="panel rounded-xl mb-3 overflow-hidden">
        <button type="button" className="tap w-full flex items-center gap-2 p-3.5 text-left" aria-expanded={setup} onClick={() => setSetup(!setup)}>
          <span className="font-display text-[11px] uppercase text-ink2 tracking-[0.16em] flex-1">Einrichtung</span>
          <span className="text-xs text-ink2">E-Mail-Versand, Sicherungen, Systemwerte</span>
          <span aria-hidden className="text-ink2">{setup ? "▴" : "▾"}</span>
        </button>
        {setup && (
          <div className="px-3 pb-1 lg:grid lg:grid-cols-2 lg:gap-x-4 lg:items-start">
            <div className="min-w-0">
              <div id="admin-system">
                <Card title="Systemwerte">
                  <StatTable rows={[
                    ["Rückstau (> 2 Min.)", s.backlog.count ? `${s.backlog.count}, ältestes ${Math.round(s.backlog.oldestOverdueSec / 60)} Min.` : "keiner"],
                    ["Letzter Prüflauf", s.audit ? `${s.audit.ok ? "ok" : "FEHLER"}, ${when(s.audit.at)}` : "–"],
                    ["Letzte Sicherung", s.backup ? `${when(s.backup.at)} (${Math.round(s.backup.ageHours)} h)` : "keine erfasst"],
                    ["Letzte E-Mail", s.mail.lastSentAt ? when(s.mail.lastSentAt) : "–"],
                    ["Letzter Mail-Fehler", s.mail.lastError ? when(s.mail.lastError.at) : "–"],
                  ]} />
                  {s.failed.lastError && <p className="text-xs text-slate-400 mt-2 break-words">Letztes fehlgeschlagenes Ereignis: {s.failed.lastType} – {s.failed.lastError}</p>}
                  {s.mail.lastError && <p className="text-xs text-slate-400 mt-1 break-words">Mail: {s.mail.lastError.message}</p>}
                  {!s.backup && <p className="text-xs text-ink2 mt-2">Automatische Sicherungen richtet der Betreiber auf dem Server ein; einzelne Sicherungen gehen jederzeit über „Jetzt sichern“.</p>}
                </Card>
              </div>
              <div id="admin-sicherungen"><AdminBackups /></div>
            </div>
            <div className="min-w-0" id="admin-mail"><AdminMail /></div>
          </div>
        )}
      </section>
    </div>
  );
}
