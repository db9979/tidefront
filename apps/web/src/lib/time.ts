// Zeit in der Oberfläche: Serverzeit (Versatz zur Geräteuhr), eine gemeinsame Uhr für alle Live-Anzeigen und die
// einheitlichen Formate für Restzeiten („56 min“, „1 h 05 min“, „2 T 3 h“, „45 s“) und Uhrzeiten („18:00 Uhr“,
// „morgen 06:00 Uhr“).
import { useSyncExternalStore } from "react";

const MIN = 60_000;
const HOUR = 3_600_000;

let offsetMs = 0;

/** Offset = serverNow − Date.now() beim Empfang. */
export function noteServerTime(serverNow: number): void {
  offsetMs = serverNow - Date.now();
  if (listeners.size > 0) emit(); // Anzeigen sofort auf die korrigierte Zeit
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

// ---- Gemeinsame Uhr --------------------------------------------------------------------------------------------
// Ein einziger Zeitgeber für die ganze App (statt setInterval je Zeile). Er tickt auf volle Sekunden, nur solange
// jemand zuhört, und ruht in versteckten Tabs (Akku); beim Zurückkehren sofort ein Tick.

const listeners = new Set<() => void>();
let current = serverNow();
let lastEmit = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function emit(): void {
  current = serverNow();
  lastEmit = Date.now();
  for (const l of [...listeners]) l();
}

function schedule(): void {
  if (timer !== undefined || listeners.size === 0 || hidden()) return;
  // Auf die nächste volle Sekunde ausrichten, damit Countdowns gleichmäßig springen.
  timer = setTimeout(() => {
    timer = undefined;
    emit();
    schedule();
  }, 1000 - (Date.now() % 1000) + 5);
}

function stop(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function onVisibility(): void {
  if (hidden()) stop();
  else {
    emit();
    schedule();
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (listeners.size === 1 && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  if (Date.now() - lastEmit > 1000) queueMicrotask(emit); // Uhr stand still (niemand hörte zu): gleich nachziehen
  schedule();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      stop();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

function snapshot(): number {
  // Ohne Zuhörer läuft die Uhr nicht: beim ersten Lesen frische Zeit statt eines alten Standes.
  if (listeners.size === 0 && Date.now() - lastEmit > 1000) {
    current = serverNow();
    lastEmit = Date.now();
  }
  return current;
}

/**
 * Aktuelle Serverzeit aus der gemeinsamen Uhr, auf `stepMs` abgerundet: Die Komponente zeichnet nur neu, wenn sich
 * der gerundete Wert ändert (1000 = sekündlich, 60000 = minütlich).
 */
export function useNow(stepMs = 1000): number {
  const step = Math.max(1000, stepMs);
  return useSyncExternalStore(subscribe, () => Math.floor(snapshot() / step) * step, () => Math.floor(serverNow() / step) * step);
}

/**
 * Uhr für Countdowns zu den Zielzeiten: sekündlich, solange ein Ziel höchstens eine Stunde entfernt ist, sonst
 * minütlich (die Anzeige „1 h 05 min“ ändert sich ohnehin nur je Minute).
 */
export function useCountdownNow(...targets: (number | null | undefined)[]): number {
  const t = snapshot();
  const near = targets.some((x) => typeof x === "number" && x - t <= HOUR + MIN);
  return useNow(near ? 1000 : MIN);
}

// ---- Formate ---------------------------------------------------------------------------------------------------

/**
 * Restzeit einheitlich und gut lesbar: „45 s“ (unter 1 min), „56 min“, „1 h 05 min“, „2 h“, „2 T 3 h“.
 * Aufgerundet – „1 min“ heißt „höchstens eine Minute“; nie „55:59 min“.
 */
export function fmtDuration(ms: number): string {
  if (!(ms > 0)) return "gleich";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} s`;
  const totalMin = Math.ceil(s / 60);
  if (totalMin < 60) return `${totalMin} min`;
  if (totalMin < 24 * 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")} min`;
  }
  const totalH = Math.ceil(s / 3600);
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  return h === 0 ? `${d} T` : `${d} T ${h} h`;
}

export function fmtSeconds(sec: number): string {
  return fmtDuration(sec * 1000);
}

/** Alter einer Angabe: „gerade eben“, „vor 12 min“, „vor 2 h“, „vor 3 T“ (abgerundet). */
export function fmtAgo(atMs: number, now: number): string {
  const ms = Math.max(0, now - atMs);
  if (ms < MIN) return "gerade eben";
  if (ms < HOUR) return `vor ${Math.floor(ms / MIN)} min`;
  if (ms < 24 * HOUR) return `vor ${Math.floor(ms / HOUR)} h`;
  return `vor ${Math.floor(ms / (24 * HOUR))} T`;
}

/** Serverzeit → Geräteuhr; kleine Abweichungen (Laufzeit der Antwort) bleiben unberücksichtigt. */
function local(ms: number): Date {
  return new Date(Math.abs(offsetMs) > 2000 ? ms - offsetMs : ms);
}

function dayIndex(d: Date): number {
  return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
}

/**
 * Zeitpunkt ohne „Uhr“: „18:00“ (heute), „morgen 06:00“, „gestern 21:15“, sonst „27.11. 18:00“.
 * `nowMs` ist die Bezugszeit (Serverzeit) für heute/morgen.
 */
export function fmtAt(ms: number, nowMs = serverNow()): string {
  const d = local(ms);
  const days = dayIndex(d) - dayIndex(local(nowMs));
  const clock = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const prefix = days === 0 ? "" : days === 1 ? "morgen " : days === -1 ? "gestern " : `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} `;
  return `${prefix}${clock}`;
}

/** Zeitpunkt einheitlich mit „Uhr“: „18:00 Uhr“, „morgen 06:00 Uhr“, „27.11. 18:00 Uhr“. */
export function fmtTime(ms: number, nowMs?: number): string {
  return `${fmtAt(ms, nowMs)} Uhr`;
}

/** Zeitspanne „23:00–06:00 Uhr“ bzw. „23:00–morgen 06:00 Uhr“ (Tagesbezug des Endes ist der Beginn). */
export function fmtRange(startMs: number, endMs: number, nowMs?: number): string {
  return `${fmtAt(startMs, nowMs)}–${fmtAt(endMs, startMs)} Uhr`;
}
