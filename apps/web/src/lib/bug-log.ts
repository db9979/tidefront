// Client-Log für „Fehler melden“: Ringpuffer der letzten Einträge aus console.error/warn, unbehandelten Fehlern
// und fehlgeschlagenen Serveraufrufen. Eingaben werden nie mitgeschrieben; Passwörter, Token und Cookies geschwärzt.

export interface LogEntry { at: number; level: "error" | "warn" | "trpc" | "info"; text: string }

const MAX_ENTRIES = 200;
const MAX_TEXT = 1000;
const entries: LogEntry[] = [];
let installed = false;

const SECRET_RE = /((?:pass(?:word|wort)?|token|secret|authorization|cookie|tf_session|api[_-]?key|(?:invite|reset)_?code)["']?\s*[:=]\s*["']?)[^\s"',;}&]+/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;

/** Schwärzt Passwörter, Token und Auth-Kopfzeilen. */
export function redact(s: string): string {
  return s.replace(SECRET_RE, "$1***").replace(BEARER_RE, "$1 ***");
}

function show(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack.split("\n").slice(1, 6).join("\n")}` : ""}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? String(x) : x))?.slice(0, MAX_TEXT) ?? String(v);
  } catch {
    return String(v);
  }
}

export function logEntry(level: LogEntry["level"], ...parts: unknown[]): void {
  const text = redact(parts.map(show).join(" ")).slice(0, MAX_TEXT);
  entries.push({ at: Date.now(), level, text });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/** Fehlgeschlagener tRPC-Aufruf: Weg, Art und Fehlercode, nie die Eingabe. */
export function logTrpcError(path: string, type: string, err: unknown): void {
  const e = err as { message?: string; data?: { code?: string; httpStatus?: number } | null };
  logEntry("trpc", `${type} ${path} fehlgeschlagen: ${e?.data?.code ?? "NETZ"}${e?.data?.httpStatus ? ` (${e.data.httpStatus})` : ""} – ${e?.message ?? String(err)}`);
}

export function logSnapshot(): LogEntry[] {
  return entries.slice();
}

export function logText(list: LogEntry[] = entries): string {
  return list.map((e) => `${new Date(e.at).toISOString()} [${e.level}] ${e.text}`).join("\n");
}

/** Einmal beim Start: Konsole und globale Fehler mitschreiben (die Konsole gibt weiterhin alles aus). */
export function installBugLog(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  for (const level of ["error", "warn"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        logEntry(level, ...args);
      } catch {
        // Mitschreiben darf nie die Ausgabe verhindern.
      }
      orig(...args);
    };
  }
  window.addEventListener("error", (e) => {
    logEntry("error", `Unbehandelter Fehler: ${e.message || "?"}`, e.filename ? `(${e.filename}:${e.lineno}:${e.colno})` : "", e.error ?? "");
  });
  window.addEventListener("unhandledrejection", (e) => logEntry("error", "Unbehandelte Ablehnung:", e.reason));
  logEntry("info", `Start ${location.pathname}${location.search} · Version ${__APP_VERSION__}`);
}

// ---------------------------------------------------------------- Melden anstoßen (Handbuch, Einstellungen)

const REQUEST_EVENT = "tf-bug-report";

/** Öffnet „Fehler melden“: die App schließt Handbuch/Einstellungen, macht den Screenshot und zeigt den Entwurf. */
export function requestBugReport(): void {
  window.dispatchEvent(new Event(REQUEST_EVENT));
}

export function onBugReportRequest(fn: () => void): () => void {
  window.addEventListener(REQUEST_EVENT, fn);
  return () => window.removeEventListener(REQUEST_EVENT, fn);
}
