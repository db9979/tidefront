import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useViewScroll } from "./lib/view-scroll.ts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "./lib/trpc.ts";
import { useLive } from "./lib/live.ts";
import { useNow } from "./lib/time.ts";
import { ActionBarHost, Loading } from "./ui.tsx";
import { Icon } from "./icons.tsx";
// Anmeldung und Hafenwahl nur bei Bedarf laden: angemeldete Spieler mit Hafen brauchen sie nicht.
const AuthScreen = lazy(() => import("./screens/Auth.tsx").then((m) => ({ default: m.AuthScreen })));
const ChooseBase = lazy(() => import("./screens/ChooseBase.tsx").then((m) => ({ default: m.ChooseBase })));
import { BaseScreen } from "./screens/Base.tsx";
const MapScreen = lazy(() => import("./screens/MapScreen.tsx").then((m) => ({ default: m.MapScreen })));
const TroopsScreen = lazy(() => import("./screens/Troops.tsx").then((m) => ({ default: m.TroopsScreen })));
const MissionPlan = lazy(() => import("./screens/MissionPlan.tsx").then((m) => ({ default: m.MissionPlan })));
import type { MeldungenTab } from "./screens/Meldungen.tsx";
const MeldungenScreen = lazy(() => import("./screens/Meldungen.tsx").then((m) => ({ default: m.MeldungenScreen })));
import { SeasonEndBanner } from "./components/Season.tsx";
const MarketScreen = lazy(() => import("./screens/Market.tsx").then((m) => ({ default: m.MarketScreen })));
const Handbook = lazy(() => import("./screens/Handbook.tsx").then((m) => ({ default: m.Handbook })));
import { ResourceBar } from "./components/ResourceBar.tsx";
import { Welcome, welcomeSeen } from "./components/Welcome.tsx";
import { useBackLayer } from "./lib/back.ts";
import { UpdateNotices } from "./components/Changelog.tsx";
import { TickerBar, useTickerPos } from "./components/market/TickerBar.tsx";
import { useGuide, type GuideAction } from "./components/Guide.tsx";
import { useDaily } from "./components/Daily.tsx";
import { parseOpenUrl, type OpenTarget } from "./lib/push.ts";
import { usePlanRequests, type PlanPreset } from "./lib/plan-request.ts";
import { initActiveBase, isBaseQueryKey, isNoBase, resetActiveBase, setActiveBase, useActiveBaseId } from "./lib/active-base.ts";
const ResearchScreen = lazy(() => import("./screens/Research.tsx").then((m) => ({ default: m.ResearchScreen })));
import { ResearchRollPopup } from "./components/ResearchDice.tsx";
import { onBugReportRequest } from "./lib/bug-log.ts";
import { captureScreen, waitForSettled } from "./lib/screenshot.ts";
import { isThreat } from "./lib/expansion.ts"; // Mehrere Häfen: eigene Verlegung ist kein Angriff
import { NavContext } from "./lib/nav.ts"; // „Was hilft?“: Sprünge aus Hinweisen
import type { NavTarget } from "./lib/remedies/types.ts";
import type { BugDraft } from "./components/BugReport.tsx";
const BugReportSheet = lazy(() => import("./components/BugReport.tsx").then((m) => ({ default: m.BugReportSheet })));

export type Tab = "basis" | "karte" | "truppen" | "berichte" | "boerse";
/** Missionsziel; eventId: Weltereignis (Schatzschiff, Großflotte, Belagerung). */
export interface Target { col: number; row: number; eventId?: number; /** Karte: dieses Missionsblatt öffnen. */ missionId?: number }
export interface Target { col: number; row: number; eventId?: number; blockadeId?: number; convoyId?: number; naval?: "minen" | "raeumen" | "blockade" } // See: Seeziele
export interface Target { fieldId?: number; fieldMission?: "besetzen" | "aufklaerung" } // Felder
export interface Target { expansion?: "gruendung" | "verlegung" | "transport" } // Mehrere Häfen: Art vorbelegen
export interface Target { postId?: number; intelOp?: "patrouille" | "kampagne" | "radarposten" } // Lagebild Stufe 2

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "basis", label: "Basis", icon: "nav-basis" },
  { id: "karte", label: "Karte", icon: "nav-karte" },
  { id: "truppen", label: "Truppen", icon: "nav-truppen" },
  { id: "berichte", label: "Meldungen", icon: "nav-bericht" },
  { id: "boerse", label: "Börse", icon: "nav-boerse" },
];

/** Gelesen-Merker der Berichte je Spieler (höchste gesehene Berichts-ID). */
const seenKey = (playerId: number) => `tf-reports-seen:${playerId}`;
const LEGACY_SEEN_KEY = "tf-reports-seen";

/** Adresse mit dem aktuellen Reiter und der offenen Einstellungs-/Verwaltungsansicht, damit Neuladen dort bleibt. */
function appUrl(tab: Tab, view: "settings" | "admin" | null): string {
  const q = new URLSearchParams();
  if (tab !== "basis") q.set("tab", tab);
  if (view) q.set("view", view);
  const s = q.toString();
  return s ? `${location.pathname}?${s}` : location.pathname;
}

/** Alter, geräteweiter Gelesen-Merker: nur der erste Spieler übernimmt ihn, danach wird er gelöscht. */
function initialSeen(playerId: number): number {
  const own = localStorage.getItem(seenKey(playerId));
  if (own !== null) return Number(own) || 0;
  const legacy = localStorage.getItem(LEGACY_SEEN_KEY);
  if (legacy === null) return 0;
  localStorage.setItem(seenKey(playerId), legacy);
  localStorage.removeItem(LEGACY_SEEN_KEY);
  return Number(legacy) || 0;
}

export function App() {
  const me = useQuery(trpc.auth.me.queryOptions());
  const player = me.data?.player;
  if (me.isLoading) return <Loading />;
  if (!player) return <Suspense fallback={<Loading />}><AuthScreen /></Suspense>;
  // Neuer Schlüssel je Spieler: nach Abmelden oder Spielerwechsel beginnen alle Ansichten frisch.
  return <Game key={player.id} playerId={player.id} playerName={player.name} onLoggedOut={() => void me.refetch()} />;
}

function Game({ playerId, playerName, onLoggedOut }: { playerId: number; playerName: string; onLoggedOut: () => void }) {
  const loggedIn = true;
  // Mehrere Häfen: aktiver Hafen (null = Heimathafen) vor der ersten Abfrage laden; eigener Cache-Schlüssel je Hafen.
  useState(() => {
    initActiveBase(playerId);
    const fromUrl = parseOpenUrl(location.href).base; // Push-Deep-Link ?base= (Server prüft den Besitz)
    if (fromUrl) setActiveBase(fromUrl);
  });
  const activeId = useActiveBaseId();
  const base = useQuery({ ...trpc.base.get.queryOptions(activeId !== null ? { baseId: activeId } : undefined), enabled: loggedIn, refetchInterval: 30000, placeholderData: keepPreviousData });
  useNoBaseFallback(base.error);
  const switchKey = useBaseSwitch(activeId);
  const hasBase = !!base.data?.base;
  const reports = useQuery({ ...trpc.report.list.queryOptions(), enabled: hasBase, refetchInterval: 60000 });
  const messages = useQuery({ ...trpc.social.messages.unread.queryOptions(), enabled: hasBase, refetchInterval: 60000 });
  const daily = useDaily(hasBase);
  const guide = useGuide(hasBase);
  // Abholbereit: Tagesbefehle und Auftragsbuch zusammen an „Basis“.
  const claimable = (daily.data?.claimable ?? 0) + (guide.data?.claimable ?? 0);
  useLive(loggedIn);
  const now = useNow();
  // Ziel aus einer Benachrichtigung (?tab=…, ?view=…) beim Start und per Nachricht vom Service Worker.
  const [opened] = useState<OpenTarget>(() => parseOpenUrl(location.href));
  const [tab, setTab] = useState<Tab>(opened.tab ?? "basis");
  const tickerPos = useTickerPos(); // Börsen-Kurszeile oben/unten (Einstellungen)
  const [plan, setPlan] = useState<{ target: Target | null; preset?: PlanPreset; seq?: number } | null>(null);
  // Forschung: Unterbildschirm (aus dem Forschungsamt oder Truppen), die untere Navigation bleibt bei fünf Zielen.
  const [research, setResearch] = useState(false);
  // „Wiederholen“ aus Berichten und Truppen öffnet die Planung mit Ziel und Zusammensetzung.
  usePlanRequests((r) => { setHelp(false); setResearch(false); setPlan({ target: r.target, preset: { type: r.type, units: r.units }, seq: Date.now() }); });
  const [mapFocus, setMapFocus] = useState<Target | null>(null);
  const [help, setHelp] = useState(!!opened.view);
  const [helpView, setHelpView] = useState(opened.view ?? null);
  const onMarket = tab === "boerse" && !plan && !help;
  // Neu aufbauen, wenn eine Benachrichtigung eine andere Ansicht öffnet (Wechsel im Handbuch selbst meldet onView).
  const [helpKey, setHelpKey] = useState(0);
  const [sheet, setSheet] = useState<string | null>(null);
  const [seen, setSeen] = useState(() => initialSeen(playerId));
  const [sub, setSub] = useState<MeldungenTab>("berichte");
  // „Was hilft?“: Zähler je Sprung (baut Truppen/Börse mit dem gewählten Unterreiter neu auf), Ressource für die Börse.
  const [navSeq, setNavSeq] = useState(0);
  const [marketRes, setMarketRes] = useState<string | undefined>(undefined);
  // Begrüßung hat Vorrang vor „Neu in Version“ (das erst danach erscheint).
  const [welcome, setWelcome] = useState(() => !welcomeSeen(playerId));
  // „Fehler melden“: Handbuch/Einstellungen schließen, Ansicht abwarten, Screenshot, dann Entwurf zeigen.
  const [bug, setBug] = useState<BugDraft | null>(null);
  const [bugReq, setBugReq] = useState(0);
  const screenRef = useRef("");
  useEffect(() => onBugReportRequest(() => {
    setHelp(false);
    setHelpView(null);
    setBugReq((n) => n + 1);
  }), []);
  useEffect(() => {
    if (bugReq === 0) return;
    let stop = false;
    void (async () => {
      await waitForSettled();
      const screen = screenRef.current;
      const shot = stop ? null : await captureScreen();
      if (!stop) setBug({ shot, screen });
    })();
    return () => { stop = true; };
  }, [bugReq]);
  // Zurück schließt die offene Ansicht (Handbuch, Planung, Forschung); Blätter haben eigene Ebenen.
  useBackLayer(help || !!plan || research, () => {
    setHelp(false);
    setHelpView(null);
    setPlan(null);
    setResearch(false);
  }, 1);

  // Nach der Zurück-Ebene, damit der neue Verlaufseintrag die neue Adresse trägt.
  useEffect(() => {
    history.replaceState(history.state, "", appUrl(tab, help ? helpView : null));
  }, [tab, help, helpView]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "open" || typeof e.data.url !== "string") return;
      const t = parseOpenUrl(e.data.url);
      setPlan(null);
      setHelpView(t.view ?? null);
      setHelpKey((k) => k + 1);
      setHelp(!!t.view);
      if (t.tab) setTab(t.tab);
      if (t.base) setActiveBase(t.base);
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [opened]);

  // Höchste ID statt erster Zeile: bei gleichen Zeitpunkten ist die Reihenfolge der Liste nicht eindeutig.
  const newestReport = (reports.data ?? []).reduce((m, r) => Math.max(m, r.id), 0);
  useEffect(() => {
    if (tab === "berichte" && sub === "berichte" && newestReport > seen) {
      localStorage.setItem(seenKey(playerId), String(newestReport));
      setSeen(newestReport);
    }
  }, [tab, sub, newestReport, seen, playerId]);

  // Scrollposition je Ansicht (Reiter + Unterreiter); Planung, Handbuch, Forschung öffnen immer oben.
  // Hafenwechsel: eigener Satz Positionen je Hafen (Schlüssel mit Hafen), damit jede Ansicht oben beginnt.
  const mainScroll = useViewScroll(`${switchKey}|${help ? "handbuch" : research ? "forschung" : plan ? "planung" : tab === "berichte" ? `berichte:${sub}` : tab}`);

  if (base.isLoading || !base.data) return <Loading />;
  if (!base.data.base) return <Suspense fallback={<Loading />}><ChooseBase /></Suspense>;
  const b = base.data.base;
  const unread = (reports.data ?? []).filter((r) => r.id > seen).length;
  const unreadMsgs = messages.data?.count ?? 0;

  const logout = async () => {
    await trpcClient.auth.logout.mutate();
    queryClient.clear();
    history.replaceState(null, "", location.pathname);
    onLoggedOut();
  };
  const go = (t: Tab) => {
    // Meldungen öffnen dort, wo Neues liegt.
    if (t === "berichte" && tab !== "berichte") setSub(unread === 0 && unreadMsgs > 0 ? "nachrichten" : "berichte");
    setPlan(null);
    setHelp(false);
    setHelpView(null);
    setResearch(false);
    setMarketRes(undefined);
    setTab(t);
  };
  const onGuide = (a: GuideAction) => {
    if (a.kind === "building") {
      go("basis");
      setSheet(a.id);
    } else go(a.tab);
  };
  const openPlan = (target: Target | null) => {
    setHelp(false);
    setResearch(false);
    setPlan({ target });
  };

  const openResearch = () => { setPlan(null); setHelp(false); setResearch(true); };
  /** Hafenwechsel aus Kopfleiste oder Karte: Planung schließen (Ursprung wäre falsch), Reiter bleibt. */
  const switchBase = (id: number) => {
    setPlan(null);
    setSheet(null);
    setActiveBase(b.bases.find((x) => x.id === id)?.isHome ? null : id);
  };
  /** Sprung aus einem Hinweis („Was hilft?“): Reiter, Unterreiter, Gebäude-Blatt, Forschung, Börse mit Ressource. */
  const navTo = (t: NavTarget) => {
    setNavSeq((n) => n + 1);
    switch (t.to) {
      case "building": go("basis"); setSheet(t.id); break;
      case "base": go("basis"); setSheet(null); break;
      case "research": setSheet(null); openResearch(); break;
      case "market":
        if (t.seg) localStorage.setItem("tf-seg:boerse", t.seg); // useSegment liest den Unterreiter beim Aufbau
        setSheet(null);
        go("boerse");
        setMarketRes(t.resource); // nach go(), das die Vorwahl zurücksetzt
        break;
      case "troops": localStorage.setItem("tf-seg:truppen", t.seg); setSheet(null); go("truppen"); break;
      case "map": setSheet(null); go("karte"); break;
      case "meldungen": setSheet(null); go("berichte"); setSub(t.sub); break;
    }
  };
  const fullBleed = tab === "karte" && !plan && !help && !research;
  screenRef.current = help ? "Handbuch" : research ? "Forschung" : plan ? "Missionsplanung"
    : `${TABS.find((x) => x.id === tab)?.label ?? tab}${tab === "berichte" ? ` · ${sub}` : ""}${tab === "basis" && sheet ? ` · Blatt ${sheet}` : ""}`;
  const content = help ? (
    <Handbook key={helpKey} onClose={() => { setHelp(false); setHelpView(null); }} onLogout={logout} playerName={playerName} initialView={helpView} onView={setHelpView} />
  ) : research ? (
    <ResearchScreen key={b.id} base={b} asOf={base.data.serverNow} onClose={() => setResearch(false)} />
  ) : plan ? (
    <MissionPlan key={`${b.id}:${plan.seq ?? 0}`} base={b} initialTarget={plan.target} preset={plan.preset} onClose={() => setPlan(null)} onPickOnMap={() => go("karte")} />
  ) : tab === "basis" ? (
    <>
      <SeasonEndBanner onOpen={() => { go("berichte"); setSub("rangliste"); }} />
      <BaseScreen key={b.id} base={b} asOf={base.data.serverNow} sheet={sheet} setSheet={setSheet} onGuide={onGuide} onTroops={() => go("truppen")} onResearch={openResearch} />
    </>
  ) : tab === "karte" ? (
    <MapScreen key={`${b.id}:${mapFocus?.missionId ?? "karte"}`} base={b} focus={mapFocus} onPlan={openPlan} onSwitchBase={switchBase} />
  ) : tab === "truppen" ? (
    <TroopsScreen key={`${b.id}:${navSeq}`} base={b} onResearch={openResearch} onPlan={() => openPlan(null)} onShowOnMap={(t) => { setMapFocus(t); go("karte"); }} />
  ) : tab === "berichte" ? (
    <MeldungenScreen sub={sub} setSub={setSub} unread={{ berichte: unread, nachrichten: unreadMsgs }} onShowOnMap={(t) => { setMapFocus(t); go("karte"); }} />
  ) : (
    <MarketScreen key={`${b.id}:${navSeq}`} base={b} initialResource={marketRes} />
  );

  return (
    <NavContext.Provider value={{ go: navTo, base: b }}>
    <div className="h-full flex flex-col max-w-xl mx-auto">
      <ResourceBar base={b} asOf={base.data.serverNow} now={now} onSwitchBase={switchBase} onPlanFounding={() => go("karte")} onHelp={() => { setHelpView(null); setHelp((h) => !h); }} />
      {/* Kurszeile: auf der Börse immer (oben, außer „unten“ gewählt), sonst nach Einstellung. */}
      {(onMarket ? tickerPos !== "unten" : tickerPos === "oben") && <TickerBar onOpen={() => go("boerse")} />}
      <main ref={mainScroll.ref} onScroll={mainScroll.onScroll} className={`flex-1 min-h-0 ${fullBleed ? "" : "overflow-y-auto overflow-x-hidden p-3 pb-8 scroll-pb-8"}`}><Suspense fallback={<Loading />}>{content}</Suspense>{!fullBleed && <ActionBarHost />}</main>
      {tickerPos === "unten" && <TickerBar onOpen={() => go("boerse")} />}
      <nav className="grid grid-cols-5 bg-paper border-t-[3px] border-double border-ink" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map((t) => {
          const active = tab === t.id && !plan && !help;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              className={`tap relative flex flex-col items-center justify-center pt-1.5 pb-1 text-[11px] leading-tight ${active ? "text-ink font-semibold" : "text-ink2"}`}
              aria-current={active ? "page" : undefined}
            >
              {active && <span className="absolute -top-[3px] inset-x-[22%] h-[3px] bg-siegel" />}
              <Icon id={t.icon} size={24} />
              <span className="mt-0.5">{t.label}</span>
              {t.id === "berichte" && unread + unreadMsgs > 0 && (
                <span className="absolute top-1 right-[18%] min-w-5 h-5 px-1 rounded-full bg-siegel text-white text-[11px] mono grid place-items-center">{unread + unreadMsgs}</span>
              )}
              {t.id === "basis" && claimable > 0 && (
                <span className="absolute top-1 left-[18%] min-w-5 h-5 px-1 rounded-full bg-moos text-white text-[11px] mono grid place-items-center" title="Belohnung abholbereit">{claimable}</span>
              )}
              {t.id === "basis" && (b.incoming.some(isThreat) || b.bases.some((x) => x.underAttack)) && (
                <span className="absolute top-1.5 right-[24%] w-3 h-3 rotate-45 bg-siegel pulse" />
              )}
            </button>
          );
        })}
      </nav>
      {welcome && <Welcome playerId={playerId} onDone={() => setWelcome(false)} />}
      <ResearchRollPopup key={b.id} base={b} />
      <UpdateNotices playerId={playerId} paused={welcome} />
      {bug && <Suspense fallback={null}><BugReportSheet draft={bug} playerName={playerName} onClose={() => setBug(null)} /></Suspense>}
    </div>
    </NavContext.Provider>
  );
}

/** Server meldet „Hafen nicht eigen“ (Saisonwechsel, veraltete ID): zurück auf den Heimathafen. */
function useNoBaseFallback(error: unknown) {
  useEffect(() => {
    if (isNoBase(error)) resetActiveBase();
  }, [error]);
  useEffect(() => queryClient.getQueryCache().subscribe((e) => {
    if (e.type === "updated" && e.action.type === "error" && isNoBase(e.action.error)) resetActiveBase();
  }), []);
}

/**
 * Hafenwechsel: hafenbezogene Abfragen ohne eigenen Hafen-Schlüssel (Markt, Felder, Admirale …) verwerfen, damit
 * nichts vom vorigen Hafen stehen bleibt. Liefert einen Zähler, der je Wechsel steigt (Scrollpositionen).
 */
function useBaseSwitch(activeId: number | null): number {
  const [n, setN] = useState(0);
  const last = useRef(activeId);
  useEffect(() => {
    if (last.current === activeId) return;
    last.current = activeId;
    setN((x) => x + 1);
    void queryClient.resetQueries({
      predicate: (q) => isBaseQueryKey(q.queryKey) && !hasBaseId(q.queryKey),
    });
  }, [activeId]);
  return n;
}

function hasBaseId(queryKey: readonly unknown[]): boolean {
  const opts = queryKey[1] as { input?: { baseId?: unknown } } | undefined;
  return typeof opts?.input?.baseId === "number";
}

