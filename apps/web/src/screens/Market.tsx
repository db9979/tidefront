// Börse als Handelsoberfläche: Kopf mit Kreditkonto, Tickerband, Kurstafel, Kursdiagramm, Ordermaske, Spielerhandel.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { label } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Card, Loading } from "../ui.tsx";
import { PlayerTrade } from "../components/PlayerTrade.tsx";
import { PlayerTradeStats } from "../components/TradeValue.tsx";
import { useWorldEvents } from "../components/WorldEvents.tsx";
import { MarketHeader, type MarketStatus } from "../components/market/MarketHeader.tsx";
import { Ticker } from "../components/market/Ticker.tsx";
import { PriceBoard } from "../components/market/PriceBoard.tsx";
import { PriceChart } from "../components/market/PriceChart.tsx";
import { OrderTicket } from "../components/market/OrderTicket.tsx";
import type { MarketCfg } from "../components/market/calc.ts";
import { MarketNews } from "../components/MarketNews.tsx";
import { ConvoyList, useNaval } from "../components/Naval.tsx"; // See: Konvois, Blockade

export function MarketScreen({ base }: { base: BaseData }) {
  const m = useQuery({ ...trpc.market.get.queryOptions(), refetchInterval: 30000 });
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const we = useWorldEvents();
  const naval = useNaval();
  const now = useNow();
  const [resource, setResource] = useState("stahl");
  if (!m.data || !meta.data) return <Loading />;

  const cfg = meta.data.balance.market as MarketCfg;
  const fromLevel = (meta.data.balance.buildings as { hafenkommandantur?: { marketFromLevel?: number } }).hafenkommandantur?.marketFromLevel ?? 3;
  const harbor = base.buildings.find((b) => b.id === "hafenkommandantur")?.level ?? 0;
  const unlocked = base.market.unlocked;
  const siege = !!we.data?.ownSiege;
  const attack = base.incoming.some((i) => i.type === "ueberfall" || i.type === "kartell");
  const port = base.market.port.name;
  const travelMs = Number.isFinite(base.market.port.distanceKm) && cfg.convoySpeedKmh > 0 ? (base.market.port.distanceKm / cfg.convoySpeedKmh) * 3_600_000 : null;
  const credits = m.data.credits;
  const sel = m.data.resources.find((r) => r.id === resource) ?? m.data.resources[0];
  const halted = m.data.resources.filter((r) => r.haltedUntilMs > now);

  const status: MarketStatus = !unlocked
    ? { tone: "closed", title: "Geschlossen", reasons: [`Öffnet ab Hafenkommandantur Stufe ${fromLevel} (deine: ${harbor}). Kurse kannst du schon beobachten.`] }
    : siege && attack
      ? { tone: "closed", title: "Gesperrt", reasons: [] }
      : siege
        ? { tone: "partial", title: "Käufe gesperrt", reasons: [] }
        : attack
          ? { tone: "partial", title: "Verkäufe gesperrt", reasons: [] }
          : { tone: "open", title: "Geöffnet", reasons: [] };
  if (unlocked && siege) status.reasons.push("Belagerungsring vor deinem Hafen: keine Börsenkäufe.");
  if (unlocked && attack) status.reasons.push("Angriff erkannt: keine Verkäufe, bis er vorbei ist.");
  if (unlocked && naval.data?.ownBlockade) { status.reasons.push("Seeblockade vor deinem Hafen: keine Verkäufe, Lieferungen werden zurückgehalten."); if (status.tone === "open") { status.tone = "partial"; status.title = "Verkäufe gesperrt"; } } // See
  if (halted.length > 0) status.reasons.push(`Handelspause: ${halted.map((r) => `${label(r.id)} (noch ${fmtDuration(r.haltedUntilMs - now)})`).join(", ")}.`);
  if (unlocked && status.tone === "open" && halted.length > 0) status.tone = "partial";

  return (
    <div>
      <MarketHeader credits={credits} creditLimit={base.market.creditLimit} status={status} port={port} travelMs={travelMs} />
      <Ticker resources={m.data.resources} nowMs={now} halfLife={cfg.reversionHalfLifeHours} />
      <MarketNews compact />
      <PriceBoard resources={m.data.resources} selected={sel.id} onSelect={setResource} nowMs={now} halfLife={cfg.reversionHalfLifeHours} />

      <Card title={<><Icon id={sel.id} size={18} /> Kursverlauf {label(sel.id)}</>}>
        <PriceChart r={sel} nowMs={now} cfg={cfg} />
      </Card>

      <Card title={<><Icon id="credits" size={18} /> Order {label(sel.id)}</>} right={<span className="text-[11px] text-ink2">Gebühr {cfg.fee * 100} %</span>}>
        {unlocked ? (
          <OrderTicket r={sel} cfg={cfg} nowMs={now}
            ctx={{ credits, creditLimit: base.market.creditLimit, stock: base.resources[sel.id] ?? 0, port, travelMs, siege, attack }} />
        ) : (
          <div className="flex gap-3 items-center rounded-lg border border-dashed border-ink/50 bg-inset p-3" role="status">
            <Icon id="hafenkommandantur" size={52} />
            <div className="text-sm">
              <div className="font-serif text-[17px]">Ordermaske noch versiegelt</div>
              <p className="text-ink2">Kaufen und Verkaufen ab Hafenkommandantur Stufe {fromLevel}. Deine hat Stufe {harbor} – noch {Math.max(0, fromLevel - harbor)} {fromLevel - harbor === 1 ? "Stufe" : "Stufen"}.</p>
              <div className="flex gap-1 mt-1.5" aria-hidden="true">
                {Array.from({ length: fromLevel }, (_, i) => <span key={i} className={`h-1.5 flex-1 ${i < harbor ? "bg-messing" : "bg-rule"}`} />)}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title={<><Icon id="nav-bericht" size={18} /> Marktnachrichten</>}>
        <MarketNews limit={6} showRefs />
      </Card>

      <ConvoyList />
      <PlayerTrade base={base} />
      <PlayerTradeStats />
    </div>
  );
}
