import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient } from "./lib/trpc.ts";
import { useLive } from "./lib/live.ts";
import { Loading } from "./ui.tsx";
import { AuthScreen } from "./screens/Auth.tsx";
import { ChooseBase } from "./screens/ChooseBase.tsx";
import { BaseScreen } from "./screens/Base.tsx";
import { MapScreen } from "./screens/MapScreen.tsx";
import { TroopsScreen } from "./screens/Troops.tsx";
import { MissionPlan } from "./screens/MissionPlan.tsx";
import { ReportsScreen } from "./screens/Reports.tsx";
import { MarketScreen } from "./screens/Market.tsx";

export type Tab = "basis" | "karte" | "truppen" | "berichte" | "boerse";
export interface Target { col: number; row: number }

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "basis", label: "Basis", icon: "⚓" },
  { id: "karte", label: "Karte", icon: "🗺" },
  { id: "truppen", label: "Truppen", icon: "🎖" },
  { id: "berichte", label: "Berichte", icon: "📜" },
  { id: "boerse", label: "Börse", icon: "⚖" },
];

export function App() {
  const me = useQuery(trpc.auth.me.queryOptions());
  const loggedIn = !!me.data?.player;
  const base = useQuery({ ...trpc.base.get.queryOptions(), enabled: loggedIn, refetchInterval: 30000 });
  useLive(loggedIn);
  const [tab, setTab] = useState<Tab>("basis");
  const [plan, setPlan] = useState<{ target: Target | null } | null>(null);
  const [mapFocus, setMapFocus] = useState<Target | null>(null);

  if (me.isLoading) return <Loading />;
  if (!loggedIn) return <AuthScreen />;
  if (base.isLoading || !base.data) return <Loading />;
  if (!base.data.base) return <ChooseBase />;

  const logout = async () => {
    await trpcClient.auth.logout.mutate();
    queryClient.clear();
    await me.refetch();
  };

  const openPlan = (target: Target | null) => setPlan({ target });
  const content = plan ? (
    <MissionPlan
      base={base.data.base}
      initialTarget={plan.target}
      onClose={() => setPlan(null)}
      onPickOnMap={() => { setPlan(null); setTab("karte"); }}
    />
  ) : tab === "basis" ? (
    <BaseScreen base={base.data.base} asOf={base.data.serverNow} playerName={me.data!.player!.name} onLogout={logout} />
  ) : tab === "karte" ? (
    <MapScreen base={base.data.base} focus={mapFocus} onPlan={openPlan} />
  ) : tab === "truppen" ? (
    <TroopsScreen base={base.data.base} onPlan={() => openPlan(null)} onShowOnMap={(t) => { setMapFocus(t); setTab("karte"); }} />
  ) : tab === "berichte" ? (
    <ReportsScreen />
  ) : (
    <MarketScreen base={base.data.base} />
  );

  return (
    <div className="h-full flex flex-col max-w-xl mx-auto">
      <main className={`flex-1 min-h-0 ${tab === "karte" && !plan ? "" : "overflow-y-auto p-3"}`}>{content}</main>
      <nav className="grid grid-cols-5 bg-navy-900 border-t border-navy-700" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setPlan(null); setTab(t.id); }}
            className={`tap flex flex-col items-center justify-center py-1 text-xs ${tab === t.id && !plan ? "text-brass-400" : "text-slate-300"}`}
            aria-current={tab === t.id ? "page" : undefined}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
