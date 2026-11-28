import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useViewScroll } from "./lib/view-scroll.ts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "./lib/trpc.ts";
import { useLive } from "./lib/live.ts";
import { useDueRefresh } from "./lib/due.ts"; // Bau fertig, Mission angekommen: Daten nachholen
import { ActionBarHost, Loading, openCard } from "./ui.tsx";
import { NavBar, TABS, type Tab } from "./components/NavBar.tsx"; // Hauptnavigation, eine Zahl je Reiter
import { useDesktop } from "./lib/media.ts"; // Desktop ab 1024 px: Leiste links, Karte + Seitenleiste
// Anmeldung und Hafenwahl nur bei Bedarf laden: angemeldete Spieler mit Hafen brauchen sie nicht.
const AuthScreen = lazy(() => import("./screens/Auth.tsx").then((m) => ({ default: m.AuthScreen })));
const ChooseBase = lazy(() => import("./screens/ChooseBase.tsx").then((m) => ({ default: m.ChooseBase })));
import { BasisScreen, type BasisTab } from "./screens/Basis.tsx"; // Basis: Lage (Startseite) · Hafen
const MapScreen = lazy(() => import("./screens/MapScreen.tsx").then((m) => ({ default: m.MapScreen })));
const TroopsScreen = lazy(() => import("./screens/Troops.tsx").then((m) => ({ default: m.TroopsScreen })));
const MissionPlan = lazy(() => import("./screens/MissionPlan.tsx").then((m) => ({ default: m.MissionPlan })));
import { asMeldungenTab, MELDUNGEN_SUBS, type MeldungenTab } from "./screens/Meldungen.tsx"; // UX 0.43: Berichte · Post · Allianz · Saison
const MeldungenScreen = lazy(() => import("./screens/Meldungen.tsx").then((m) => ({ default: m.MeldungenScreen })));
const MarketScreen = lazy(() => import("./screens/Market.tsx").then((m) => ({ default: m.MarketScreen })));
const Handbook = lazy(() => import("./screens/Handbook.tsx").then((m) => ({ default: m.Handbook })));
// Handbuch, Einstellungen, Verwaltung: gleichrangige Ansichten (UX-0.43 B2), nur bei Bedarf geladen.
const SettingsScreen = lazy(() => import("./screens/Settings.tsx").then((m) => ({ default: m.SettingsScreen })));
const AdminScreen = lazy(() => import("./screens/Admin.tsx").then((m) => ({ default: m.AdminScreen })));
import { isSaisonSub, useAppViews, type OpenView, type ViewId } from "./lib/app-views.ts";
import { useShortcuts, type ShortcutHandlers } from "./lib/shortcuts.ts"; // 1–5, A, M, ?, „,“, Esc
import { RailFooter, type RailItem } from "./components/RailFooter.tsx"; // Desktop-Leiste unten
import { ProgressChip } from "./components/ProgressChip.tsx"; // Desktop-Kopfleiste: Platz, Abstand, Saisontag
import { ResourceBar } from "./components/ResourceBar.tsx";
import { Welcome, welcomeSeen } from "./components/Welcome.tsx";
import { useBackLayer } from "./lib/back.ts";
import { UpdateNotices } from "./components/Changelog.tsx";
import { PushAsk } from "./components/PushAsk.tsx"; // UX 0.43 (A7): Push einmalig im Moment des Nutzens
import { TickerBar, useTickerPos } from "./components/market/TickerBar.tsx";
import { useGuide, type GuideAction } from "./components/Guide.tsx";
import { useDaily } from "./components/Daily.tsx";
import { useLageBadge } from "./components/lage/LageTab.tsx"; // Lagezentrum: Zahl Dringendes an „Basis“
import { parseOpenUrl, type OpenTarget } from "./lib/push.ts";
import { usePlanRequests, type PlanPreset } from "./lib/plan-request.ts";
import { initActiveBase, isBaseQueryKey, isNoBase, resetActiveBase, setActiveBase, useActiveBaseId } from "./lib/active-base.ts";
const ResearchScreen = lazy(() => import("./screens/Research.tsx").then((m) => ({ default: m.ResearchScreen })));
import { ResearchRollPopup } from "./components/ResearchDice.tsx";
import { onBugReportRequest } from "./lib/bug-log.ts";
import { captureScreen, waitForSettled } from "./lib/screenshot.ts";
import { isThreat } from "./lib/expansion.ts"; // Mehrere Häfen: eigene Verlegung ist kein Angriff
export type { Tab };
import { NavContext } from "./lib/nav.ts"; // „Was hilft?“: Sprünge aus Hinweisen
import type { NavTarget } from "./lib/remedies/types.ts";
import type { BugDraft } from "./components/BugReport.tsx";
const BugReportSheet = lazy(() => import("./components/BugReport.tsx").then((m) => ({ default: m.BugReportSheet })));

export interface Target { col: number; row: number; eventId?: number; /** Karte: dieses Missionsblatt öffnen. */ missionId?: number }
export interface Target { col: number; row: number; eventId?: number; blockadeId?: number; convoyId?: number; naval?: "minen" | "raeumen" | "blockade" } // See: Seeziele
export interface Target { fieldId?: number; fieldMission?: "besetzen" | "aufklaerung" } // Felder
export interface Target { expansion?: "gruendung" | "verlegung" | "transport" } // Mehrere Häfen: Art vorbelegen
export interface Target { postId?: number; intelOp?: "patrouille" | "kampagne" | "radarposten" } // Lagebild Stufe 2

/** Gelesen-Merker der Berichte je Spieler (höchste gesehene Berichts-ID). */
const seenKey = (playerId: number) => `tf-reports-seen:${playerId}`;
const LEGACY_SEEN_KEY = "tf-reports-seen";

/** Adresse mit Reiter, Unterreiter (Basis → Hafen, Meldungen außer Berichte) und offener Einstellungs-/Verwaltungs-
 *  ansicht, damit Neuladen dort bleibt. */
function appUrl(tab: Tab, view: ViewId | null, sub: string | null): string {
  const q = new URLSearchParams();
  if (tab !== "basis") q.set("tab", tab);
  if (sub) q.set("sub", sub);
  if (view === "settings" || view === "admin") q.set("view", view); // Handbuch: ohne Adresse (wie bisher)
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
  if (me.error && !me.data) return <Loading error={me.error} onRetry={() => void me.refetch()} />;
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
  const lageBadge = useLageBadge(hasBase, claimable);
  useLive(loggedIn);
  useDueRefresh(base.data?.base ?? null);
  // Ziel aus einer Benachrichtigung (?tab=…, ?view=…) beim Start und per Nachricht vom Service Worker.
  const [opened] = useState<OpenTarget>(() => parseOpenUrl(location.href));
  const views = useAppViews(opened.view ?? null);
  const [tab, setTab] = useState<Tab>(opened.tab ?? "basis");
  const tickerPos = useTickerPos(); // Börsen-Kurszeile oben/unten (Einstellungen)
  const [plan, setPlan] = useState<{ target: Target | null; preset?: PlanPreset; seq?: number } | null>(null);
  // Forschung: Unterbildschirm (aus dem Forschungsamt oder Truppen), die untere Navigation bleibt bei fünf Zielen.
  const [research, setResearch] = useState(false);
  // „Wiederholen“ aus Berichten und Truppen öffnet die Planung mit Ziel und Zusammensetzung.
  usePlanRequests((r) => { views.closeAll(); setMapBig(false); setResearch(false); setPlan({ target: r.target, preset: { type: r.type, units: r.units }, seq: Date.now() }); });
  // Sprungziel für die Karte (z. B. „auf der Karte zeigen“). Die Karte verbraucht es beim Öffnen einmal; mapSeq erzwingt
  // dafür ein neues Kartenbild. Danach bleibt die Karte bei späterer Rückkehr ohne geöffnetes Missions-/Feldblatt.
  const [mapFocus, setMapFocus] = useState<Target | null>(null);
  const [mapSeq, setMapSeq] = useState(0);
  const showOnMap = (t: Target) => { setMapFocus(t); setMapSeq((n) => n + 1); go("karte"); };
  // Sichtungen (früher Karte → Sichtungen): Blatt der Karte; wie mapFocus einmal beim Öffnen verbraucht.
  const [mapSichtungen, setMapSichtungen] = useState(opened.tab === "karte" && opened.sub === "sichtungen");
  const openSichtungen = () => { setMapSichtungen(true); setMapSeq((n) => n + 1); go("karte"); };
  const desktop = useDesktop();
  // Desktop: „Karte groß“ legt die Karte über die gewählte Ansicht, ohne Reiter oder Ansicht zu verlassen.
  const [mapBig, setMapBig] = useState(false);
  const lastTab = useRef<Tab>("basis"); // „Karte groß“ aus dem Reiter Karte zurück: voriger Reiter
  const help = !!views.top;
  const onMarket = tab === "boerse" && !plan && !help;
  const [sheet, setSheet] = useState<string | null>(null);
  const [seen, setSeen] = useState(() => initialSeen(playerId));
  // Meldungen: ?bericht= öffnet den Bericht, ?sub= einen Unterreiter; sonst Berichte.
  const [sub, setSub] = useState<MeldungenTab>(() => (opened.report === undefined && opened.tab === "berichte" && opened.sub && MELDUNGEN_SUBS.includes(opened.sub) ? asMeldungenTab(opened.sub) : "berichte"));
  // Basis: Startseite ist die Lage („Was steht an?“); ?sub=hafen (Neuladen auf dem Hafen) öffnet den Hafen.
  const [basisSub, setBasisSub] = useState<BasisTab>(() => ((opened.tab ?? "basis") === "basis" && opened.sub === "hafen" ? "hafen" : "lage"));
  // „Was hilft?“: Zähler je Sprung (baut Truppen/Börse mit dem gewählten Unterreiter neu auf), Ressource für die Börse.
  const [navSeq, setNavSeq] = useState(0);
  const [marketRes, setMarketRes] = useState<string | undefined>(undefined);
  const [marketOrder, setMarketOrder] = useState<{ side: "buy" | "sell"; qty?: number } | undefined>(undefined);
  // Begrüßung hat Vorrang vor „Neu in Version“ (das erst danach erscheint).
  const [welcome, setWelcome] = useState(() => !welcomeSeen(playerId));
  // „Fehler melden“: Handbuch/Einstellungen schließen, Ansicht abwarten, Screenshot, dann Entwurf zeigen.
  const [bug, setBug] = useState<BugDraft | null>(null);
  const [bugReq, setBugReq] = useState(0);
  const screenRef = useRef("");
  const closeViews = views.closeAll;
  useEffect(() => onBugReportRequest(() => {
    closeViews();
    setBugReq((n) => n + 1);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Zurück schließt Planung und Forschung (Handbuch/Einstellungen/Verwaltung: lib/app-views.ts); Blätter haben eigene Ebenen.
  useBackLayer(!!plan || research, () => {
    setPlan(null);
    setResearch(false);
  }, 1);

  // Nach der Zurück-Ebene, damit der neue Verlaufseintrag die neue Adresse trägt.
  useEffect(() => {
    const urlSub = tab === "basis" ? (basisSub === "hafen" ? "hafen" : null) : tab === "berichte" && sub !== "berichte" ? sub : null;
    history.replaceState(history.state, "", appUrl(tab, views.top?.id ?? null, urlSub));
  }, [tab, views.top, basisSub, sub]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "open" || typeof e.data.url !== "string") return;
      const t = parseOpenUrl(e.data.url);
      setPlan(null);
      setMapBig(false);
      if (t.view) views.open({ id: t.view }); else views.closeAll();
      if (t.tab) setTab(t.tab);
      if (t.tab === "basis") setBasisSub(t.sub === "hafen" ? "hafen" : "lage");
      if (t.tab === "berichte" && t.sub) setSub(asMeldungenTab(t.sub));
      if (t.tab === "karte" && t.sub === "sichtungen") { setMapSichtungen(true); setMapSeq((n) => n + 1); }
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
  // Tastaturkürzel: Hook vor den frühen Rückgaben, die Handler werden unten bei jedem Aufbau gesetzt.
  const keys = useRef<ShortcutHandlers | null>(null);
  useShortcuts(true, {
    tab: (i) => keys.current?.tab(i),
    handbook: () => keys.current?.handbook(),
    settings: () => keys.current?.settings(),
    mapToggle: () => keys.current?.mapToggle(),
    escape: () => keys.current?.escape() ?? false,
  });
  const mainScroll = useViewScroll(`${switchKey}|${desktop ? "d" : "m"}|${help ? `ansicht:${views.top?.id}` : research ? "forschung" : plan ? "planung" : tab === "berichte" ? `berichte:${sub}` : tab === "basis" ? `basis:${basisSub}` : tab}`);

  if (base.isLoading || !base.data) return <Loading error={base.isLoading ? undefined : base.error} onRetry={() => void base.refetch()} />;
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
    // Meldungen öffnen dort, wo etwas Neues liegt (Berichte vor Nachrichten), sonst im zuletzt gewählten Reiter.
    if (t === "berichte" && tab !== "berichte") {
      if (unread > 0) setSub("berichte");
      else if (unreadMsgs > 0) setSub("nachrichten");
    }
    setPlan(null);
    views.closeAll();
    setMapBig(false);
    setResearch(false);
    setMarketRes(undefined);
    setMarketOrder(undefined);
    setTab(t);
  };
  const onGuide = (a: GuideAction) => {
    if (a.kind === "building") {
      go("basis");
      setBasisSub("hafen");
      setSheet(a.id);
    } else if (a.kind === "tab") go(a.tab); // plan: runGuideAction öffnet die Planung selbst
  };
  const openPlan = (target: Target | null) => {
    views.closeAll();
    setMapBig(false);
    setResearch(false);
    setPlan({ target });
  };

  const openResearch = () => { setPlan(null); views.closeAll(); setMapBig(false); setResearch(true); };
  /** Handbuch, Einstellungen, Verwaltung öffnen (cross: Querverweis aus einer offenen Ansicht, Zurück führt dorthin). */
  const openView = (v: OpenView, cross = false) => { setPlan(null); setResearch(false); setMapBig(false); views.open(v, cross); };
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
      case "building": go("basis"); setBasisSub("hafen"); setSheet(t.id); break;
      case "base": go("basis"); setBasisSub("hafen"); setSheet(null); break;
      case "lage": setSheet(null); go("basis"); setBasisSub("lage"); break;
      case "sichtungen": setSheet(null); openSichtungen(); break;
      case "research": setSheet(null); openResearch(); break;
      case "market":
        if (t.seg) localStorage.setItem("tf-seg:boerse", t.seg); // useSegment liest den Unterreiter beim Aufbau
        setSheet(null);
        go("boerse");
        setMarketRes(t.resource); // nach go(), das die Vorwahl zurücksetzt
        setMarketOrder(t.side ? { side: t.side, qty: t.qty } : undefined);
        break;
      case "troops": localStorage.setItem("tf-seg:truppen", t.seg); setSheet(null); go("truppen"); break;
      case "map": setSheet(null); go("karte"); break;
      case "view": setSheet(null); openView({ id: t.view, focus: t.focus ?? null }); break;
      case "meldungen":
        setSheet(null);
        if (t.sub === "lagebild") { openSichtungen(); break; } // alter Name der Sichtungen (Karte)
        go("berichte"); setSub(t.sub); break;
    }
  };
  /** Sprungziel = aktueller Bildschirm (ohne Vorwahl)? Dann bietet „Was hilft?“ den Knopf nicht an. */
  const here = (t: NavTarget): boolean => {
    if (t.to === "view") return views.top?.id === t.view;
    if (help || plan) return false;
    if (t.to === "research") return research;
    if (research) return false;
    switch (t.to) {
      case "building": return tab === "basis" && basisSub === "hafen" && sheet === t.id;
      case "base": return tab === "basis" && basisSub === "hafen" && !sheet;
      case "lage": return tab === "basis" && basisSub === "lage";
      case "sichtungen": return false;
      case "market": return tab === "boerse" && !t.resource && !t.side && (localStorage.getItem("tf-seg:boerse") ?? "handel") === (t.seg ?? "handel");
      case "troops": return tab === "truppen" && localStorage.getItem("tf-seg:truppen") === t.seg;
      case "map": return tab === "karte";
      case "meldungen": return t.sub !== "lagebild" && tab === "berichte" && (sub === t.sub || (t.sub === "saison" && sub === "rangliste") || (t.sub === "rangliste" && sub === "saison"));
    }
  };
  const mapActive = (tab === "karte" && !plan && !help && !research) || (desktop && mapBig);
  // Desktop-Textansichten (E-7): ohne Karte in voller Breite – Handbuch, Einstellungen, Verwaltung, Forschung, Saison.
  const textView = desktop && !plan && (help || research || (tab === "berichte" && isSaisonSub(sub)));
  const fullBleed = mapActive && !desktop;
  screenRef.current = help ? ({ handbuch: "Handbuch", settings: "Einstellungen", admin: "Verwaltung" } as const)[views.top!.id] : research ? "Forschung" : plan ? "Missionsplanung"
    : `${TABS.find((x) => x.id === tab)?.label ?? tab}${tab === "berichte" ? ` · ${sub}` : ""}${tab === "basis" ? ` · ${basisSub}` : ""}${tab === "basis" && sheet ? ` · Blatt ${sheet}` : ""}`;
  const attack = lageBadge.attack || b.incoming.some(isThreat) || b.bases.some((x) => x.underAttack);
  // Karte: mobil ganzflächig im Reiter „Karte“; am Desktop immer links sichtbar (side = Feldblatt rechts daneben,
  // embedded = ohne Blatt, Antippen eines Feldes wechselt zum Reiter „Karte“).
  const map = (
    <MapScreen key={`${b.id}:${mapSeq}`} base={b} focus={mapFocus} onFocusUsed={() => setMapFocus(null)} onPlan={openPlan} onSwitchBase={switchBase}
      layout={desktop ? (mapActive ? "side" : "embedded") : "mobile"} onActivate={() => go("karte")}
      sichtungen={mapSichtungen} onSichtungenUsed={() => setMapSichtungen(false)} />
  );
  const v = views.top;
  const content = v ? (
    v.id === "handbuch" ? <Handbook onClose={views.back} onSettings={() => openView({ id: "settings" }, true)} />
      : v.id === "settings" ? <SettingsScreen key={v.focus ?? ""} onClose={views.back} onHandbook={() => openView({ id: "handbuch" }, true)} onLogout={() => void logout()} focus={v.focus} />
      : <AdminScreen onClose={views.back} />
  ) : research ? (
    <ResearchScreen key={b.id} base={b} asOf={base.data.serverNow} onClose={() => setResearch(false)} />
  ) : plan ? (
    <MissionPlan key={`${b.id}:${plan.seq ?? 0}`} base={b} initialTarget={plan.target} preset={plan.preset} onClose={() => setPlan(null)} onPickOnMap={() => go("karte")} />
  ) : tab === "basis" ? (
    <BasisScreen base={b} asOf={base.data.serverNow} sub={basisSub} setSub={setBasisSub} lageCount={lageBadge.count} sheet={sheet} setSheet={setSheet}
      onGuide={onGuide} onTroops={() => go("truppen")} onResearch={openResearch} onShowOnMap={showOnMap}
      onSeasonEnd={() => { go("berichte"); setSub("saison"); }} unreadMsgs={unreadMsgs} seenReport={seen} />
  ) : tab === "karte" ? (
    desktop ? null : map
  ) : tab === "truppen" ? (
    <TroopsScreen key={`${b.id}:${navSeq}`} base={b} onResearch={openResearch} onPlan={() => openPlan(null)} onShowOnMap={showOnMap} />
  ) : tab === "berichte" ? (
    <MeldungenScreen sub={sub} setSub={setSub} unread={{ berichte: unread, nachrichten: unreadMsgs }} onShowOnMap={showOnMap} />
  ) : (
    <MarketScreen key={`${b.id}:${navSeq}`} base={b} initialResource={marketRes} initialOrder={marketOrder} />
  );
  // Desktop: „Karte groß“ schaltet um (Karte über der Ansicht bzw. zurück zum vorigen Reiter); mobil wie bisher.
  const toggleMap = () => {
    if (mapBig) setMapBig(false);
    else if (mapActive) go(lastTab.current);
    else setMapBig(true);
  };
  const pickTab = (t: Tab) => {
    if (desktop && t === "karte") { toggleMap(); return; }
    if (t === "karte" && tab === "karte" && !plan && !help && !research) setMapSeq((n) => n + 1); // erneut „Karte“: Blatt zu, frisch
    go(t);
  };
  if (tab !== "karte") lastTab.current = tab;
  const openSaison = () => navTo({ to: "meldungen", sub: "rangliste" }); // Saison (Rangliste) – Alias auch nach dem Umbau
  const railCurrent: RailItem | null = mapBig ? null : v ? v.id : tab === "berichte" && isSaisonSub(sub) && !plan && !research ? "saison" : null;
  const railFooter = <RailFooter current={railCurrent} onPick={(i) => (i === "saison" ? openSaison() : openView({ id: i }))} />;
  const nav = <NavBar tab={tab} active={!plan && !help && railCurrent !== "saison"} rail={desktop} badges={{ lage: lageBadge.count, attack, unread: unread + unreadMsgs }} onPick={pickTab}
    mapBig={desktop && mapActive} footer={railFooter} />;
  const resourceBar = (
    <ResourceBar base={b} asOf={base.data.serverNow} onSwitchBase={switchBase} onPlanFounding={() => go("karte")} onPower={() => { setSheet(null); go("basis"); setBasisSub("hafen"); openCard("basis-versorgung", "versorgung"); }} onMenu={(i) => {
      if (i === "logout") { void logout(); return; }
      openView({ id: i });
    }} desktop={desktop} extra={desktop ? <ProgressChip onOpen={openSaison} /> : undefined} />
  );
  // Kurszeile: auf der Börse immer (oben, außer „unten“ gewählt), sonst nach Einstellung – nur nicht über der
  // ganzflächigen Karte am Handy (dort zählt jede Zeile Karte; nach 0.46).
  const tickerTop = !fullBleed && (onMarket ? tickerPos !== "unten" : tickerPos === "oben") && <TickerBar onOpen={() => go("boerse")} />;
  const tickerBottom = !fullBleed && tickerPos === "unten" && <TickerBar onOpen={() => go("boerse")} />;
  const overlays = (
    <>
      {welcome && <Welcome playerId={playerId} onDone={() => setWelcome(false)} />}
      <ResearchRollPopup key={b.id} base={b} />
      <UpdateNotices playerId={playerId} paused={welcome} />
      {!welcome && <PushAsk nightStartHour={b.protection.nightShieldStartHour} />}
      {bug && <Suspense fallback={null}><BugReportSheet draft={bug} playerName={playerName} onClose={() => setBug(null)} /></Suspense>}
    </>
  );

  keys.current = {
    tab: (i) => pickTab(TABS[i].id),
    handbook: () => openView({ id: "handbuch" }),
    settings: () => openView({ id: "settings" }),
    mapToggle: () => { if (desktop) toggleMap(); },
    escape: () => {
      if (views.top) { views.back(); return true; }
      if (desktop && mapBig) { setMapBig(false); return true; }
      return false;
    },
  };

  if (desktop) {
    // Desktop: Navigationsleiste links, Karte in der Mitte (immer geladen), rechts die Seitenleiste mit dem Reiter.
    return (
      <NavContext.Provider value={{ go: navTo, base: b, here }}>
      <div className="h-full flex w-full" data-layout="desktop">
        {nav}
        <div className="flex-1 min-w-0 flex flex-col">
          {resourceBar}
          {tickerTop}
          <div className="flex-1 min-h-0 flex">
            {/* Textansichten blenden die Karte aus (bleibt geladen, damit „Karte groß“ sofort da ist). */}
            <section className={`flex-1 min-w-0 relative ${textView && !mapActive ? "hidden" : ""}`} aria-label="Karte" data-testid="desktop-map">
              <Suspense fallback={<Loading />}>{map}</Suspense>
            </section>
            {!mapActive && (
              <main ref={mainScroll.ref} onScroll={mainScroll.onScroll} data-testid="desktop-side" data-text-view={textView ? "true" : undefined}
                className={`${textView ? "flex-1 min-w-0" : "w-[min(540px,44vw)] shrink-0 border-l-[3px] border-double border-ink"} bg-paper overflow-y-auto overflow-x-hidden p-3 pb-8 scroll-pb-8`}>
                <div className={textView ? "mx-auto w-full max-w-[1180px] px-3" : ""}>
                  <Suspense fallback={<Loading cards={3} />}>{content}</Suspense><ActionBarHost />
                </div>
              </main>
            )}
          </div>
          {tickerBottom}
        </div>
        {overlays}
      </div>
      </NavContext.Provider>
    );
  }

  return (
    <NavContext.Provider value={{ go: navTo, base: b, here }}>
    <div className="h-full flex flex-col w-full max-w-xl mx-auto" data-layout="mobile">
      {resourceBar}
      {tickerTop}
      <main ref={mainScroll.ref} onScroll={mainScroll.onScroll} className={`flex-1 min-h-0 ${fullBleed ? "" : "overflow-y-auto overflow-x-hidden p-3 pb-8 scroll-pb-8"}`}><Suspense fallback={fullBleed ? <Loading /> : <Loading cards={3} />}>{content}</Suspense>{!fullBleed && <ActionBarHost />}</main>
      {tickerBottom}
      {nav}
      {overlays}
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

