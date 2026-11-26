import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "./lib/trpc.ts";
import { useLive } from "./lib/live.ts";
import { useNow } from "./lib/time.ts";
import { Loading } from "./ui.tsx";
import { Icon } from "./icons.tsx";
import { AuthScreen } from "./screens/Auth.tsx";
import { ChooseBase } from "./screens/ChooseBase.tsx";
import { BaseScreen } from "./screens/Base.tsx";
import { MapScreen } from "./screens/MapScreen.tsx";
import { TroopsScreen } from "./screens/Troops.tsx";
import { MissionPlan } from "./screens/MissionPlan.tsx";
import { MeldungenScreen, type MeldungenTab } from "./screens/Meldungen.tsx";
import { SeasonEndBanner } from "./components/Season.tsx";
import { MarketScreen } from "./screens/Market.tsx";
import { Handbook } from "./screens/Handbook.tsx";
import { ResourceBar } from "./components/ResourceBar.tsx";
import { Welcome } from "./components/Welcome.tsx";
import { UpdateNotices } from "./components/Changelog.tsx";
import type { GuideAction } from "./components/Guide.tsx";
import { useDaily } from "./components/Daily.tsx";
import { parseOpenUrl, type OpenTarget } from "./lib/push.ts";
import { usePlanRequests, type PlanPreset } from "./lib/plan-request.ts";

export type Tab = "basis" | "karte" | "truppen" | "berichte" | "boerse";
export interface Target { col: number; row: number }

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "basis", label: "Basis", icon: "nav-basis" },
  { id: "karte", label: "Karte", icon: "nav-karte" },
  { id: "truppen", label: "Truppen", icon: "nav-truppen" },
  { id: "berichte", label: "Meldungen", icon: "nav-bericht" },
  { id: "boerse", label: "Börse", icon: "nav-boerse" },
];

const SEEN_KEY = "tf-reports-seen";

export function App() {
  const me = useQuery(trpc.auth.me.queryOptions());
  const loggedIn = !!me.data?.player;
  const base = useQuery({ ...trpc.base.get.queryOptions(), enabled: loggedIn, refetchInterval: 30000 });
  const hasBase = !!base.data?.base;
  const reports = useQuery({ ...trpc.report.list.queryOptions(), enabled: hasBase, refetchInterval: 60000 });
  const messages = useQuery({ ...trpc.social.messages.unread.queryOptions(), enabled: hasBase, refetchInterval: 60000 });
  const daily = useDaily(hasBase);
  useLive(loggedIn);
  const now = useNow();
  // Ziel aus einer Benachrichtigung (?tab=…, ?view=…) beim Start und per Nachricht vom Service Worker.
  const [opened] = useState<OpenTarget>(() => parseOpenUrl(location.href));
  const [tab, setTab] = useState<Tab>(opened.tab ?? "basis");
  const [plan, setPlan] = useState<{ target: Target | null; preset?: PlanPreset; seq?: number } | null>(null);
  // „Wiederholen“ aus Berichten und Truppen öffnet die Planung mit Ziel und Zusammensetzung.
  usePlanRequests((r) => { setHelp(false); setPlan({ target: r.target, preset: { type: r.type, units: r.units }, seq: Date.now() }); });
  const [mapFocus, setMapFocus] = useState<Target | null>(null);
  const [help, setHelp] = useState(!!opened.view);
  const [helpView, setHelpView] = useState(opened.view ?? null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(SEEN_KEY) ?? 0));
  const [sub, setSub] = useState<MeldungenTab>("berichte");

  useEffect(() => {
    if (opened.tab || opened.view) history.replaceState(null, "", "/");
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "open" || typeof e.data.url !== "string") return;
      const t = parseOpenUrl(e.data.url);
      setPlan(null);
      setHelpView(t.view ?? null);
      setHelp(!!t.view);
      if (t.tab) setTab(t.tab);
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [opened]);

  const newestReport = reports.data?.[0]?.id ?? 0;
  useEffect(() => {
    if (tab === "berichte" && sub === "berichte" && newestReport > seen) {
      localStorage.setItem(SEEN_KEY, String(newestReport));
      setSeen(newestReport);
    }
  }, [tab, sub, newestReport, seen]);

  if (me.isLoading) return <Loading />;
  if (!loggedIn) return <AuthScreen />;
  if (base.isLoading || !base.data) return <Loading />;
  if (!base.data.base) return <ChooseBase />;
  const b = base.data.base;
  const unread = (reports.data ?? []).filter((r) => r.id > seen).length;
  const unreadMsgs = messages.data?.count ?? 0;

  const logout = async () => {
    await trpcClient.auth.logout.mutate();
    queryClient.clear();
    await me.refetch();
  };
  const go = (t: Tab) => {
    // Meldungen öffnen dort, wo Neues liegt.
    if (t === "berichte" && tab !== "berichte") setSub(unread === 0 && unreadMsgs > 0 ? "nachrichten" : "berichte");
    setPlan(null);
    setHelp(false);
    setHelpView(null);
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
    setPlan({ target });
  };

  const fullBleed = tab === "karte" && !plan && !help;
  const content = help ? (
    <Handbook key={helpView ?? "h"} onClose={() => setHelp(false)} onLogout={logout} playerName={me.data!.player!.name} initialView={helpView} />
  ) : plan ? (
    <MissionPlan key={plan.seq ?? 0} base={b} initialTarget={plan.target} preset={plan.preset} onClose={() => setPlan(null)} onPickOnMap={() => go("karte")} />
  ) : tab === "basis" ? (
    <>
      <SeasonEndBanner onOpen={() => { go("berichte"); setSub("rangliste"); }} />
      <BaseScreen base={b} asOf={base.data.serverNow} sheet={sheet} setSheet={setSheet} onGuide={onGuide} onTroops={() => go("truppen")} />
    </>
  ) : tab === "karte" ? (
    <MapScreen base={b} focus={mapFocus} onPlan={openPlan} />
  ) : tab === "truppen" ? (
    <TroopsScreen base={b} onPlan={() => openPlan(null)} onShowOnMap={(t) => { setMapFocus(t); go("karte"); }} />
  ) : tab === "berichte" ? (
    <MeldungenScreen sub={sub} setSub={setSub} unread={{ berichte: unread, nachrichten: unreadMsgs }} onShowOnMap={(t) => { setMapFocus(t); go("karte"); }} />
  ) : (
    <MarketScreen base={b} />
  );

  return (
    <div className="h-full flex flex-col max-w-xl mx-auto">
      <ResourceBar base={b} asOf={base.data.serverNow} now={now} onHelp={() => { setHelpView(null); setHelp((h) => !h); }} />
      <main className={`flex-1 min-h-0 ${fullBleed ? "" : "overflow-y-auto overflow-x-hidden p-3"}`}>{content}</main>
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
              {t.id === "basis" && (daily.data?.claimable ?? 0) > 0 && (
                <span className="absolute top-1 left-[18%] min-w-5 h-5 px-1 rounded-full bg-moos text-white text-[11px] mono grid place-items-center" title="Tagesbefehl abholbereit">{daily.data!.claimable}</span>
              )}
              {t.id === "basis" && b.incoming.some((i) => i.type !== "transport") && (
                <span className="absolute top-1.5 right-[24%] w-3 h-3 rotate-45 bg-siegel pulse" />
              )}
            </button>
          );
        })}
      </nav>
      <Welcome />
      <UpdateNotices playerId={me.data!.player!.id} />
    </div>
  );
}
