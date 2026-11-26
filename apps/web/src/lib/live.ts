// WebSocket /ws: Änderungsmeldungen invalidieren passende Abfragen; Neuverbindung mit Rückstau.
import { useEffect } from "react";
import { queryClient, trpc } from "./trpc.ts";
import { noteServerTime } from "./time.ts";

const FILTERS: Record<string, () => { queryKey: readonly unknown[] }[]> = {
  base: () => [trpc.base.pathFilter()],
  missions: () => [trpc.base.pathFilter()],
  reports: () => [trpc.report.pathFilter(), trpc.base.pathFilter()],
  market: () => [trpc.market.pathFilter(), trpc.base.pathFilter()],
  map: () => [trpc.world.pathFilter()],
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
      ws?.close();
    };
  }, [enabled]);
}
