// Basis → Lage (Startseite „Was steht an?“). Reihenfolge seit UX 0.43 (A1/A2, Entscheidungen E-1 … E-4):
// Fortschrittszeile (Platz · Abstand · Saisontag, Serie) → Alarm (fremde Angriffe, Nachfrist) → Rückkehrkarte
// „Seit deinem letzten Besuch“ → Wartet auf dich (mit „Alle abholen“ in der Kopfzeile, je Hafen eine Zeile) →
// Nächster Schritt (Bauempfehlung „Stahlwerk 7 · 3 min · Bauen“; Neulinge: Erste Schritte) → Unterwegs (jede Mission
// einmal, nächstes Ereignis mit Balken) → Als Nächstes (nur Nicht-Missionen, 12 h) → Weltpolitik (einzeilig, groß nur
// bei Handlungsbedarf) → Aufträge → Zuletzt passiert. Server: lage.get, lage.since, lage.ack (engine/lage*.ts).
// Live: lib/live.ts invalidiert lage.* mit Hafen-, Missions-, Berichts- und Marktmeldungen; Countdown je Sekunde.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../../lib/trpc.ts";
import { useNow } from "../../lib/time.ts";
import { useNav } from "../../lib/nav.ts";
import { setActiveBase, useActiveBaseId } from "../../lib/active-base.ts";
import { setOpenReport } from "../../lib/push.ts";
import { readLageSeen, useLageSeen, writeLageSeen } from "../../lib/lage-seen.ts";
import { meldungenText } from "../../lib/meldungen-count.ts"; // A8: eine Zählung für Navigation und Lage
import { useDaily } from "../Daily.tsx";
import { useGuide, type GuideAction } from "../Guide.tsx";
import { useWeekly } from "../Weekly.tsx";
import { useAchievements } from "../../screens/Achievements.tsx";
import { Icon } from "../../icons.tsx";
import { Loading } from "../../ui.tsx";
import type { Target } from "../../App.tsx";
import { ClaimAllHead, ClaimAllNote, useClaimAll } from "./ClaimAll.tsx";
import { LageGroup, LageLine, type LageJump, type LageRow } from "./LageList.tsx";
import { PolitikLage } from "../politik/PolitikLine.tsx"; // Weltpolitik: einzeilig oder groß bei Handlungsbedarf
import { ProgressLine } from "./ProgressLine.tsx";
import { ReturnCard, useLageAck } from "./ReturnCard.tsx";
import { BuildAdvice, FirstSteps, useNewcomer } from "./NextStep.tsx";

const RECENT = 5;
const REPORT_ICON: Record<string, string> = { ueberfall: "ueberfall", kartell: "kartell", aufklaerung: "aufklaerung", transport: "transport", spionage: "spionage", sabotage: "sabotage", konvoi: "konvoi", blockade: "blockade", minen: "mine", patrouille: "patrouille", satellit: "satellit", sichtung: "sichtung" };
/** „Als Nächstes“: so weit voraus (UX 0.43: 12 h statt 24 h). */
export const NEXT_MS = 12 * 3_600_000;
/** Eigene Verbände und Konvois stehen nur unter „Unterwegs“ (einmal je Mission). */
const UNDERWAY_KINDS = new Set(["ankunft", "rueckkehr", "konvoi", "lieferung"]);
const ALARM_KINDS = new Set(["angriff", "nachfrist"]);

const local = (r: Partial<LageRow> & Pick<LageRow, "key" | "kind" | "icon" | "text">): LageRow =>
  ({ atMs: null, sub: null, tone: null, urgent: false, progress: null, jump: null, ...r });

export function LageTab({ onShowOnMap, unreadMsgs, seenReport, quests: questBar, base, onGuide }: {
  onShowOnMap: (t: Target) => void;
  unreadMsgs: number;
  seenReport: number;
  /** Aufträge (Auftragsbuch, Tagesbefehle, Wochenziele). */
  quests?: ReactNode;
  base: BaseData;
  onGuide: (a: GuideAction) => void;
}) {
  const now = useNow();
  const nav = useNav();
  const activeId = useActiveBaseId();
  const lage = useQuery({ ...trpc.lage.get.queryOptions(), refetchInterval: 30000 });
  const reports = useQuery({ ...trpc.report.list.queryOptions(), refetchInterval: 60000 });
  const me = useQuery(trpc.auth.me.queryOptions());
  const playerId = me.data?.player?.id ?? null;
  const daily = useDaily();
  const guide = useGuide();
  const weekly = useWeekly();
  const ach = useAchievements();
  const newcomer = useNewcomer();
  const ack = useLageAck(playerId);
  const claim = useClaimAll(ack); // E-3: Abholen quittiert die Rückkehrkarte
  // Stand beim letzten Öffnen: Einträge, die seitdem dazugekommen sind, tragen „neu“ (erster Besuch: keine Markierung).
  const [before] = useState(() => readLageSeen());
  const quests0 = (daily.data?.claimable ?? 0) + (guide.data?.claimable ?? 0);
  const allKeys = lage.data ? [...lage.data.soon, ...lage.data.underway, ...lage.data.waiting].map((r) => r.key).concat(lage.data.urgent.keys, quests0 > 0 ? [`belohnung:quests:${quests0}`] : []) : null;
  const sig = allKeys?.join("|") ?? "";
  useEffect(() => { if (allKeys) writeLageSeen(allKeys, Date.now()); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const isNew = (key: string) => before !== null && !before.keys.includes(key);
  if (!lage.data) return <Loading cards={3} error={lage.error ?? undefined} onRetry={() => void lage.refetch()} />;

  /** Mehrere Häfen: vor dem Sprung den betroffenen Hafen aktiv machen (Heimathafen = null). */
  const pickBase = (baseId: number | null | undefined) => {
    if (baseId == null) return;
    const home = nav.base?.bases.find((b) => b.isHome)?.id;
    setActiveBase(baseId === home ? null : baseId);
  };
  const isActive = (baseId: number | null | undefined) => baseId == null || baseId === (activeId ?? nav.base?.bases.find((b) => b.isHome)?.id);
  const jump = (j: LageJump) => {
    switch (j.to) {
      case "map": {
        const same = isActive(j.baseId);
        pickBase(j.baseId);
        onShowOnMap({ col: j.col, row: j.row, ...(j.missionId && same ? { missionId: j.missionId } : {}), ...(j.convoyId ? { convoyId: j.convoyId } : {}), ...(j.eventId ? { eventId: j.eventId } : {}) });
        break;
      }
      case "building": pickBase(j.baseId); nav.go({ to: "building", id: j.id }); break;
      case "base": pickBase(j.baseId); nav.go({ to: "base" }); break;
      case "research": nav.go({ to: "research" }); break;
      case "troops": pickBase(j.baseId); nav.go({ to: "troops", seg: j.seg }); break;
      case "contracts": nav.go({ to: "market", seg: "vertraege" }); break;
      case "report": setOpenReport(j.id); nav.go({ to: "meldungen", sub: "berichte" }); break;
      case "rewards": if (j.where === "erfolge") nav.go({ to: "meldungen", sub: "erfolge" }); // Aufträge stehen hier auf der Lage
        else document.querySelector('[aria-label="Aufträge"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      case "alliance": nav.go({ to: "meldungen", sub: "allianz" }); break; // TST-15: Beitrittsanfragen
      case "politik": { // Weltpolitik: Abschnitt auf der Lage (bei Handlungsbedarf), sonst Saison → Welt
        const el = document.getElementById("politik-panel");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); else nav.go({ to: "meldungen", sub: "welt" });
        break;
      }
    }
  };

  const { underway } = lage.data;
  const dq = daily.data?.claimable ?? 0;
  const gq = guide.data?.claimable ?? 0;
  const quests = dq + gq;
  const weeklyReady = weekly.data?.hasBase ? [...weekly.data.goals, ...weekly.data.older].filter((x) => x.done && !x.claimed).length : 0;
  const allReady = quests + weeklyReady + (ach.data?.claimable ?? 0);
  const alarm = lage.data.soon.filter((r) => ALARM_KINDS.has(r.kind));
  // Als Nächstes: ohne eigene Verbände/Konvois (stehen unter „Unterwegs“), ohne Alarm, 12 h; Neulinge ohne Nachtschild.
  const soon = lage.data.soon.filter((r) => !ALARM_KINDS.has(r.kind) && !UNDERWAY_KINDS.has(r.kind) && (r.atMs ?? 0) <= now + NEXT_MS && !(newcomer && r.kind === "nachtschild"));
  // TST-16: nur die Quellen nennen, die wirklich etwas abholbereit haben.
  const sources = [gq > 0 ? `${gq} im Auftragsbuch` : "", dq > 0 ? `${dq} ${dq === 1 ? "Tagesbefehl" : "Tagesbefehle"}` : ""].filter(Boolean).join(", ");
  // A8: dieselbe Zahl wie an „Meldungen“ (ungelesene Berichte + Post; Allianz-Chat zählt bewusst nicht).
  // Ungelesene Berichte wie in App.tsx (dieselbe Abfrage report.list, derselbe Merker seenReport).
  const unreadReports = (reports.data ?? []).filter((r) => r.id > seenReport).length;
  const mText = meldungenText(unreadReports, unreadMsgs);
  const waiting: LageRow[] = [
    ...(quests > 0 ? [local({ key: "belohnung:quests", kind: "belohnung", icon: "hafenmeister", tone: "gut", urgent: true,
      text: `${quests === 1 ? "1 Belohnung" : `${quests} Belohnungen`} abholbereit (${sources})`, jump: { to: "rewards", where: "basis" } })] : []),
    ...(mText ? [local({ key: "meldungen", kind: "nachrichten", icon: "nav-bericht", text: mText })] : []),
    ...lage.data.waiting,
  ];
  const openMeldungen = () => nav.go({ to: "meldungen", sub: unreadReports > 0 ? "berichte" : "nachrichten" });
  const recent = (reports.data ?? []).slice(0, RECENT);
  const empty = soon.length === 0 && underway.length === 0 && waiting.length === 0 && recent.length === 0 && alarm.length === 0;
  return (
    <div data-testid="lage-tab">
      <ProgressLine />
      {alarm.length > 0 && (
        <LageGroup title="Alarm" tone="alarm" count={alarm.length} testId="lage-alarm">
          {alarm.map((r) => <LageLine key={r.key} row={r} nowMs={now} onJump={jump} unread={isNew(r.key)} />)}
        </LageGroup>
      )}
      <ReturnCard playerId={playerId} onAck={ack} />
      {(waiting.length > 0 || claim.note) && (
        <LageGroup title="Wartet auf dich" count={waiting.length} testId="lage-waiting"
          action={<ClaimAllHead count={allReady} busy={claim.busy} onRun={() => void claim.run()} />}>
          {claim.note && <li className="list-none"><ClaimAllNote note={claim.note} /></li>}
          {waiting.map((r) => <LageLine key={r.key} row={r} nowMs={now} onJump={jump} unread={isNew(r.key)} onTap={r.kind === "nachrichten" ? openMeldungen : undefined} />)}
        </LageGroup>
      )}
      {newcomer ? <FirstSteps base={base} onGuide={onGuide} /> : <BuildAdvice advice={lage.data.advice} />}
      {empty && !newcomer && (
        <div className="panel rounded-xl p-5 text-center text-ink2 mb-3" data-testid="lage-empty">
          <Icon id="anker" size={48} className="mx-auto mb-2" />
          Ruhige See. Hier erscheint alles, was ansteht: Ankünfte, Fertigstellungen, Angriffe, Belohnungen.
        </div>
      )}
      {underway.length > 0 && (
        <LageGroup title="Unterwegs" count={underway.length} testId="lage-underway">
          {underway.map((r) => <LageLine key={r.key} row={r} nowMs={now} onJump={jump} unread={isNew(r.key)} />)}
        </LageGroup>
      )}
      {soon.length > 0 && (
        <LageGroup title="Als Nächstes" count={soon.length} testId="lage-soon">
          {soon.map((r) => <LageLine key={r.key} row={r} nowMs={now} onJump={jump} unread={isNew(r.key)} />)}
        </LageGroup>
      )}
      <PolitikLage newcomer={newcomer} />
      {questBar}
      {recent.length > 0 && (
        <LageGroup title="Zuletzt passiert" testId="lage-recent">
          {recent.map((r) => (
            <LageLine key={r.id} past unread={r.id > seenReport} nowMs={now} onJump={jump}
              row={local({ key: `bericht:${r.id}`, kind: "bericht", atMs: r.atMs, icon: REPORT_ICON[r.kind] ?? "nav-bericht", text: r.title,
                tone: r.won === null ? null : r.won ? "gut" : "alarm", jump: { to: "report", id: r.id } })} />
          ))}
        </LageGroup>
      )}
    </div>
  );
}

/** Zahl am Navigationszeichen „Basis“: nur Dringendes (Angriff, abholbereit, Nachfrist, leere Bauschlange). */
export function useLageBadge(enabled: boolean, quests: number): { count: number; attack: boolean } {
  const q = useQuery({ ...trpc.lage.badge.queryOptions(), enabled, refetchInterval: 60000 });
  const seen = useLageSeen();
  const u = q.data;
  // Nur, was seit dem letzten Öffnen der Lage neu ist; laufende Angriffe zählen immer (Sicherheit).
  const keys = [...(u?.keys ?? []), ...(quests > 0 ? [`belohnung:quests:${quests}`] : [])];
  const count = keys.filter((k) => k.startsWith("angriff:") || !seen.has(k)).length;
  return { count, attack: (u?.attacks ?? 0) > 0 };
}
