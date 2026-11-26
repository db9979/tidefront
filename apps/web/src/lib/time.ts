import { useEffect, useState } from "react";

let offsetMs = 0;

/** Offset = serverNow − Date.now() beim Empfang. */
export function noteServerTime(serverNow: number): void {
  offsetMs = serverNow - Date.now();
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Tick einmal je Sekunde; liefert die aktuelle Serverzeit. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return "gleich";
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} T ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m}:${String(sec).padStart(2, "0")} min`;
  return `${sec} s`;
}

export function fmtSeconds(sec: number): string {
  return fmtDuration(sec * 1000);
}

export function fmtTime(ms: number): string {
  return new Date(ms - offsetMs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
