// Börse als Handelsoberfläche: Unterreiter (gemerkt) ganz oben, darunter der einklappbare Kopf mit Kreditkonto und
// kompakter Marktlage:
//   Handel      – Kurstafel, Order direkt darunter (Knopf in der Aktionsleiste), Kursverlauf (eingeklappt), Konvois
//   Spieler     – Handel mit Spielern (Angebot einstellen in der Aktionsleiste) und Statistik
//   Verträge    – Lieferverträge (v1.31): Angebote der KI-Spieler, Verträge mit Spielern, eigene Verträge
//   Marktlage   – Marktnachrichten (Schlüssel bleibt „nachrichten“, damit gemerkte Wahl und Sprungziele gelten)

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { label } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Card, Loading, SegmentPanel, Segments, useSegment } from "../ui.tsx";
import { WhatHelps } from "../components/Remedy.tsx";
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
import { Contracts } from "../components/market/Contracts.tsx"; // Lieferverträge (v1.31)

type Seg = "handel" | "spieler" | "vertraege" | "nachrichten";
const SEGS: { id: Seg; label: string }[] = [
  { id: "handel", label: "Handel" },
  { id: "spieler", label: "Spieler" },
  { id: "vertraege", label: "Verträge" },
  { id: "nachrichten", label: "Marktlage" },
];

/** initialResource: vorgewählte Ressource (Sprung aus „Was hilft?“). */
export function MarketScreen({ base, initialResource }: { base: BaseData; initialResource?: string }) {
  const m = useQuery({ ...trpc.market.get.queryOptions(), refetchInterval: 30000 });
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const we = useWorldEvents();
  const naval = useNaval();
  const now = useNow();
  const [resource, setResource] = useState(initialResource ?? "stahl");
  const [seg, setSeg] = useSegment<Seg>("boerse", SEGS.map((x) => x.id), "handel");
  if (!m.data || !meta.data) return <Loading cards={3} />;

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
    ? { tone: "closed", title: "Geschlossen", reasons: [{ text: `Öffnet ab Hafenkommandantur Stufe ${fromLevel} (deine: ${harbor}). Kurse kannst du schon beobachten.` }] }
    : siege && attack
      ? { tone: "closed", title: "Gesperrt", reasons: [] }
      : siege
        ? { tone: "partial", title: "Käufe gesperrt", reasons: [] }
        : attack
          ? { tone: "partial", title: "Verkäufe gesperrt", reasons: [] }
          : { tone: "open", title: "Geöffnet", reasons: [] };
  if (unlocked && siege) status.reasons.push({ text: "Belagerungsring vor deinem Hafen: keine Börsenkäufe.", code: "siege" });
  if (unlocked && attack) status.reasons.push({ text: "Angriff erkannt: keine Verkäufe, bis er vorbei ist.", code: "under_attack" });
  if (unlocked && naval.data?.ownBlockade) { status.reasons.push({ text: "Seeblockade vor deinem Hafen: keine Verkäufe, Lieferungen werden zurückgehalten.", code: "blockade" }); if (status.tone === "open") { status.tone = "partial"; status.title = "Verkäufe gesperrt"; } } // See
  if (halted.length > 0) status.reasons.push({ text: `Handelspause: ${halted.map((r) => `${label(r.id)} (noch ${fmtDuration(r.haltedUntilMs - now)})`).join(", ")}.`, code: "halted" });
  if (unlocked && status.tone === "open" && halted.length > 0) status.tone = "partial";

  const pct = sel.history.length ? changePct(sel, now, DAY, cfg.reversionHalfLifeHours) : refPct(sel);
  const t = trend(pct);
  const pick = (id: string) => {
    setResource(id);
    // Order steht direkt unter der Kurstafel: sichtbar machen, ohne die Tafel ganz wegzuschieben.
    setTimeout(() => document.getElementById("tf-order")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 0);
  };

  return (
    <div>
      <Segments label="Börse" value={seg} onChange={setSeg} items={SEGS} controls />
      <SegmentPanel label="Börse" value={seg}>
      <MarketHeader credits={credits} creditLimit={base.market.creditLimit} status={status} port={port} travelMs={travelMs} />
      {/* Kompakte Marktlage-Zeile über dem Inhalt (nicht auf „Marktlage“ selbst). */}
      {seg !== "nachrichten" && <MarketNews compact />}

      {seg === "handel" && <>
        <PriceBoard resources={m.data.resources} selected={sel.id} onSelect={pick} nowMs={now} halfLife={cfg.reversionHalfLifeHours} />

        <Card id="tf-order" title={<><Icon id="credits" size={18} /> Order {label(sel.id)}</>} right={<span className="text-[11px] text-ink2">Gebühr {cfg.fee * 100} %</span>}>
          {unlocked ? (
            <OrderTicket r={sel} cfg={cfg} nowMs={now}
              ctx={{ credits, creditLimit: base.market.creditLimit, stock: base.resources[sel.id] ?? 0, port, travelMs, siege, attack }} base={base} />
          ) : (
            <div className="flex gap-3 items-center rounded-lg border border-dashed border-ink/50 bg-inset p-3" role="status">
              <Icon id="hafenkommandantur" size={52} />
              <div className="text-sm">
                <div className="font-serif text-[17px]">Ordermaske noch versiegelt</div>
                <p className="text-ink2">Kaufen und Verkaufen ab Hafenkommandantur Stufe {fromLevel}. Deine hat Stufe {harbor} – noch {Math.max(0, fromLevel - harbor)} {fromLevel - harbor === 1 ? "Stufe" : "Stufen"}.</p>
                <div className="flex gap-1 mt-1.5" aria-hidden="true">
                  {Array.from({ length: fromLevel }, (_, i) => <span key={i} className={`h-1.5 flex-1 ${i < harbor ? "bg-messing" : "bg-rule"}`} />)}
                </div>
                <WhatHelps code="locked" className="mt-2" />
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

      {seg === "vertraege" && <Contracts base={base} />}

      {seg === "nachrichten" && (
        <Card title={<><Icon id="nav-bericht" size={18} /> Marktlage</>}>
          <MarketNews limit={20} showRefs />
        </Card>
      )}
      </SegmentPanel>
    </div>
  );
}
