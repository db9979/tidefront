// WebSocket /ws: Änderungsmeldungen invalidieren passende Abfragen; Neuverbindung mit Rückstau.
import { useEffect } from "react";
import { queryClient, trpc } from "./trpc.ts";
import { noteServerTime } from "./time.ts";

const FILTERS: Record<string, () => { queryKey: readonly unknown[] }[]> = {
  // Tagesbefehle: Fortschritt entsteht mit Ausbau, Ausbildung, Kampf, Handel und Nachrichten.
  base: () => [trpc.base.pathFilter(), trpc.daily.pathFilter()],
  missions: () => [trpc.base.pathFilter(), trpc.daily.pathFilter()],
  reports: () => [trpc.report.pathFilter(), trpc.base.pathFilter(), trpc.social.ranking.pathFilter(), trpc.daily.pathFilter()],
  market: () => [trpc.market.pathFilter(), trpc.base.pathFilter(), trpc.daily.pathFilter(), trpc.playerTrade.pathFilter()],
  map: () => [trpc.world.pathFilter()],
  messages: () => [trpc.social.messages.pathFilter(), trpc.daily.pathFilter()],
  // Allianzen, Chat, Diplomatie (Kürzel und Beziehungen in der Rangliste)
  alliance: () => [trpc.alliance.pathFilter(), trpc.playerTrade.pathFilter()],
  // Saisonwechsel: die ganze Welt ist neu.
  season: () => [
    trpc.season.pathFilter(), trpc.social.pathFilter(), trpc.base.pathFilter(), trpc.world.pathFilter(),
    trpc.report.pathFilter(), trpc.market.pathFilter(), trpc.daily.pathFilter(),
  ],
};

/**
 * Kartenmeldungen gehen bei vielen Ereignissen an alle Spieler gleichzeitig. Damit nicht alle Clients im selben
 * Augenblick world.map neu laden: Invalidierung zufällig gestreut (300 ms bis 5 s) und zusammengefasst.
 */
const MAP_SPREAD_MS: [number, number] = [300, 5000];
/** Server schickt alle 25 s ein ping; bleibt so lange alles still, gilt die Verbindung als tot (Neuaufbau). */
const HEARTBEAT_TIMEOUT_MS = 60000;

export function useLive(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let mapTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSeen = Date.now();
    const invalidate = (kind: string) => {
      if (kind === "map") {
        if (mapTimer !== undefined) return; // schon eingeplant: zusammenfassen
        const [lo, hi] = MAP_SPREAD_MS;
        mapTimer = setTimeout(() => {
          mapTimer = undefined;
          for (const f of FILTERS.map()) void queryClient.invalidateQueries(f);
        }, lo + Math.random() * (hi - lo));
        return;
      }
      for (const f of FILTERS[kind]?.() ?? []) void queryClient.invalidateQueries(f);
    };
    // Herzschlag: ohne Meldung (ping alle 25 s) seit HEARTBEAT_TIMEOUT_MS ist die Verbindung tot (z. B. WLAN-Wechsel,
    // Schlafmodus); das Schließen kann im Browser lange dauern, daher sofort neu verbinden.
    const heartbeat = setInterval(() => {
      if (stopped || !ws || ws.readyState !== WebSocket.OPEN || Date.now() - lastSeen < HEARTBEAT_TIMEOUT_MS) return;
      const dead = ws;
      dead.onclose = null;
      dead.onmessage = null;
      dead.close();
      clearTimeout(timer);
      connect();
    }, 15000);
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      lastSeen = Date.now();
      ws.onopen = () => {
        delay = 1000;
        lastSeen = Date.now();
        // Nach Neuverbindung alles frisch holen (Meldungen könnten verpasst sein).
        void queryClient.invalidateQueries();
      };
      ws.onmessage = (ev) => {
        lastSeen = Date.now();
        try {
          const msg = JSON.parse(String(ev.data)) as { kind: string; serverNow?: number };
          if (typeof msg.serverNow === "number") noteServerTime(msg.serverNow);
          invalidate(msg.kind);
        } catch {
          /* ignorieren */
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(30000, delay * 2);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(mapTimer);
      clearInterval(heartbeat);
      // Noch im Aufbau: erst nach dem Öffnen schließen (sonst Konsolenwarnung „closed before the connection is established“).
      const w = ws;
      if (w && w.readyState === WebSocket.CONNECTING) {
        w.onopen = () => w.close();
        w.onmessage = null;
      } else w?.close();
    };
  }, [enabled]);
}
