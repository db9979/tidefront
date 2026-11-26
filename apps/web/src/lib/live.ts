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

export function useLive(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => {
        delay = 1000;
        // Nach Neuverbindung alles frisch holen (Meldungen könnten verpasst sein).
        void queryClient.invalidateQueries();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { kind: string; serverNow?: number };
          if (typeof msg.serverNow === "number") noteServerTime(msg.serverNow);
          for (const f of FILTERS[msg.kind]?.() ?? []) void queryClient.invalidateQueries(f);
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
      // Noch im Aufbau: erst nach dem Öffnen schließen (sonst Konsolenwarnung „closed before the connection is established“).
      const w = ws;
      if (w && w.readyState === WebSocket.CONNECTING) {
        w.onopen = () => w.close();
        w.onmessage = null;
      } else w?.close();
    };
  }, [enabled]);
}
