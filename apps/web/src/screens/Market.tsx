// Börse als Handelsoberfläche: Kopf mit Kreditkonto und kompakter Marktnachricht, darunter Unterreiter (gemerkt):
//   Handel      – Kurstafel, Order direkt darunter (Knopf in der Aktionsleiste), Kursverlauf (eingeklappt), Konvois
//   Spieler     – Handel mit Spielern (Angebot einstellen in der Aktionsleiste) und Statistik
//   Nachrichten – Marktnachrichten

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { label } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Card, Loading, Segments, useSegment } from "../ui.tsx";
import { PlayerTrade } from "../components/PlayerTrade.tsx";
import { PlayerTradeStats } from "../components/TradeValue.tsx";
import { useWorldEvents } from "../components/WorldEvents.tsx";
import { MarketHeader, type MarketStatus } from "../components/market/MarketHeader.tsx";
import { PriceBoard, Spark } from "../components/market/PriceBoard.tsx";
import { changePct, refPct, signed, trend, DAY, TONE_TEXT } from "../components/market/calc.ts";
import { PriceChart } from "../components/market/PriceChart.tsx";
import { OrderTicket } from "../components/market/OrderTicket.tsx";
import type { MarketCfg } from "../components/market/calc.ts";
import { MarketNews } from "../components/MarketNews.tsx";
import { ConvoyList, useNaval } from "../components/Naval.tsx"; // See: Konvois, Blockade

type Seg = "handel" | "spieler" | "nachrichten";
const SEGS: { id: Seg; label: string }[] = [
  { id: "handel", label: "Handel" },
  { id: "spieler", label: "Spieler" },
  { id: "nachrichten", label: "Nachrichten" },
];

export function MarketScreen({ base }: { base: BaseData }) {
  const m = useQuery({ ...trpc.market.get.queryOptions(), refetchInterval: 30000 });
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const we = useWorldEvents();
  const naval = useNaval();
  const now = useNow();
  const [resource, setResource] = useState("stahl");
  const [seg, setSeg] = useSegment<Seg>("boerse", SEGS.map((x) => x.id), "handel");
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

  const pct = sel.history.length ? changePct(sel, now, DAY, cfg.reversionHalfLifeHours) : refPct(sel);
  const t = trend(pct);
  const pick = (id: string) => {
    setResource(id);
    // Order steht direkt unter der Kurstafel: sichtbar machen, ohne die Tafel ganz wegzuschieben.
    requestAnimationFrame(() => document.getElementById("tf-order")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
  };

  return (
    <div>
      <MarketHeader credits={credits} creditLimit={base.market.creditLimit} status={status} port={port} travelMs={travelMs} />
      {/* Kompakte Marktnachricht-Zeile bleibt über den Unterreitern. */}
      <MarketNews compact />
      <Segments label="Börse" value={seg} onChange={setSeg} items={SEGS} />

      {seg === "handel" && <>
        <PriceBoard resources={m.data.resources} selected={sel.id} onSelect={pick} nowMs={now} halfLife={cfg.reversionHalfLifeHours} />

        <Card id="tf-order" title={<><Icon id="credits" size={18} /> Order {label(sel.id)}</>} right={<span className="text-[11px] text-ink2">Gebühr {cfg.fee * 100} %</span>}>
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

        <Card title={<><Icon id={sel.id} size={18} /> Kursverlauf {label(sel.id)}</>} collapsible storageKey="boerse-kursverlauf" defaultOpen={false}
          summary={<span className="flex items-center gap-2"><span className="w-24 shrink-0"><Spark r={sel} nowMs={now} halfLife={cfg.reversionHalfLifeHours} tone={t.tone} /></span><span className={`mono text-[12.5px] ${TONE_TEXT[t.tone]}`}>{t.arrow}&#8239;{signed(pct)} in 24 h</span></span>}>
          <PriceChart r={sel} nowMs={now} cfg={cfg} />
        </Card>

        <ConvoyList />
      </>}

      {/* Spieler: Handel mit Spielern und seine Statistik. */}
      {seg === "spieler" && <>
        <PlayerTrade base={base} />
        <PlayerTradeStats />
      </>}

      {seg === "nachrichten" && (
        <Card title={<><Icon id="nav-bericht" size={18} /> Marktnachrichten</>}>
          <MarketNews limit={20} showRefs />
        </Card>
      )}
    </div>
  );
}
