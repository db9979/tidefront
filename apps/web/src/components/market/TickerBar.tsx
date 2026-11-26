// Börsen-Kurszeile als feste Leiste oben oder ganz unten auf allen Bildschirmen (Einstellung „Kurszeile“).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../../lib/trpc.ts";
import { useNow } from "../../lib/time.ts";
import { Ticker } from "./Ticker.tsx";

export type TickerPos = "aus" | "oben" | "unten";
const KEY = "tf-kurszeile";
const EVENT = "tf-kurszeile";

export function getTickerPos(): TickerPos {
  const v = localStorage.getItem(KEY);
  return v === "oben" || v === "unten" ? v : "aus";
}

export function setTickerPos(v: TickerPos): void {
  localStorage.setItem(KEY, v);
  window.dispatchEvent(new Event(EVENT));
}

/** Aktuelle Wahl, auch nach Änderung in den Einstellungen. */
export function useTickerPos(): TickerPos {
  const [pos, setPos] = useState(getTickerPos);
  useEffect(() => {
    const on = () => setPos(getTickerPos());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  return pos;
}

/** Die Leiste selbst; Tippen öffnet die Börse. */
export function TickerBar({ onOpen }: { onOpen: () => void }) {
  const m = useQuery({ ...trpc.market.get.queryOptions(), refetchInterval: 60000 });
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const now = useNow();
  if (!m.data || !meta.data) return null;
  const halfLife = (meta.data.balance.market as { reversionHalfLifeHours: number }).reversionHalfLifeHours;
  return (
    <button type="button" className="block w-full text-left shrink-0" onClick={onOpen} aria-label="Kurszeile – zur Börse">
      <Ticker resources={m.data.resources} nowMs={now} halfLife={halfLife} bar />
    </button>
  );
}

/** Auswahl in den Einstellungen. */
export function TickerSetting() {
  const pos = useTickerPos();
  const opts: [TickerPos, string][] = [["aus", "Nur in der Börse"], ["oben", "Immer oben"], ["unten", "Immer unten"]];
  return (
    <div className="grid grid-cols-3 gap-2">
      {opts.map(([v, t]) => (
        <button
          key={v}
          type="button"
          aria-pressed={pos === v}
          onClick={() => setTickerPos(v)}
          className={`tap rounded-lg border px-2 py-2 text-xs font-semibold ${pos === v ? "border-ink bg-ink text-paper" : "border-rule text-ink"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
