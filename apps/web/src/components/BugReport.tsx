// „Fehler melden“: Entwurf mit vorausgefülltem Betreff, Beschreibung, Screenshot (abwählbar), automatischen Angaben
// und Client-Log. Der Server speichert die Meldung und mailt sie an die Verwaltung (falls E-Mail eingerichtet ist).
import { useMemo, useState } from "react";
import { trpcClient } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { logSnapshot, logText } from "../lib/bug-log.ts";
import { Button, ErrorLine, Sheet } from "../ui.tsx";

export interface BugDraft {
  /** Screenshot als JPEG-Data-URL (null: Aufnahme nicht möglich). */
  shot: string | null;
  /** Bildschirm beim Öffnen, z. B. „Karte“ oder „Basis · Blatt werft“. */
  screen: string;
}

const field = "w-full rounded-lg field px-3 mb-3";

function autoMeta(screen: string, playerName: string): Record<string, string | number | boolean> {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return {
    version: __APP_VERSION__,
    build: __BUILD_TIME__,
    bildschirm: screen,
    adresse: `${location.pathname}${location.search}`,
    browser: navigator.userAgent,
    fenster: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}x`,
    sprache: navigator.language,
    zeitzone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    zeit: new Date().toString(),
    online: navigator.onLine,
    app: standalone,
    spielername: playerName,
  };
}

const ERRORS: Record<string, string> = {
  rate: "Höchstens 5 Meldungen pro Stunde. Bitte später noch einmal.",
  bad_screenshot: "Der Screenshot ist zu groß oder beschädigt. Ohne Screenshot senden?",
};

export function BugReportSheet({ draft, playerName, onClose }: { draft: BugDraft; playerName: string; onClose: () => void }) {
  const meta = useMemo(() => autoMeta(draft.screen, playerName), [draft, playerName]);
  const log = useMemo(() => logSnapshot(), [draft]);
  const [subject, setSubject] = useState(`Fehler: ${draft.screen} (v${__APP_VERSION__})`);
  const [text, setText] = useState("");
  const [withShot, setWithShot] = useState(!!draft.shot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { mailed: boolean; id: number }>(null);
  const kb = draft.shot ? Math.round((draft.shot.length * 3) / 4 / 1024) : 0;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await trpcClient.bugReport.send.mutate({
        subject: subject.trim().slice(0, 200),
        text: text.slice(0, 5000),
        meta,
        log: logText(log),
        screenshot: withShot ? draft.shot : null,
      });
      if (r.ok) setDone({ mailed: r.mailed, id: r.id });
      else setError(ERRORS[r.code] ?? errorText(r.code));
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Sheet open onClose={onClose} title="Fehler melden">
        <p className="text-sm mb-3">
          {done.mailed
            ? `Danke! Meldung #${done.id} ist per E-Mail an die Verwaltung gegangen.`
            : `Danke! Meldung #${done.id} ist gespeichert – die Verwaltung sieht sie im Admin-Menü.`}
        </p>
        <Button className="w-full" onClick={onClose}>Schließen</Button>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="Fehler melden">
      <p className="text-sm text-ink2 mb-3">Entwurf an die Verwaltung. Prüfe und ergänze die Angaben, dann „Senden“.</p>
      <label className="text-sm text-slate-300" htmlFor="tf-bug-subject">Betreff</label>
      <input id="tf-bug-subject" className={`${field} h-11`} maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <label className="text-sm text-slate-300" htmlFor="tf-bug-text">Was ist passiert?</label>
      <textarea
        id="tf-bug-text"
        className={`${field} py-2 min-h-28`}
        maxLength={5000}
        rows={5}
        autoFocus
        placeholder="Was hast du gemacht, was ist passiert, was hättest du erwartet?"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="mb-3">
        {draft.shot ? (
          <>
            <label className="flex items-center gap-2 text-sm mb-2">
              <input type="checkbox" checked={withShot} onChange={(e) => setWithShot(e.target.checked)} />
              Screenshot mitsenden <span className="text-xs text-ink2">({kb} KB, Ansicht beim Öffnen)</span>
            </label>
            <img src={draft.shot} alt="Screenshot der Ansicht" className={`w-full max-h-72 object-contain border border-rule rounded ${withShot ? "" : "opacity-30"}`} />
          </>
        ) : (
          <p className="text-sm text-ink2">Kein Screenshot möglich – bitte beschreibe die Ansicht kurz.</p>
        )}
      </div>

      <details className="mb-2 text-sm">
        <summary className="tap cursor-pointer">Automatische Angaben</summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs mt-2">
          {Object.entries(meta).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink2">{k}</dt>
              <dd className="mono break-all">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <details className="mb-3 text-sm">
        <summary className="tap cursor-pointer">Log ({log.length} Einträge)</summary>
        <pre className="text-[11px] mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto mt-2 p-2 border border-rule rounded bg-paper">
          {log.length ? logText(log) : "Keine Einträge."}
        </pre>
      </details>

      <ErrorLine text={error} />
      <div className="flex gap-2 mt-3">
        <Button kind="secondary" className="flex-1" onClick={onClose} disabled={busy}>Abbrechen</Button>
        <Button className="flex-1" onClick={send} disabled={busy || (!text.trim() && !subject.trim())}>{busy ? "Sendet …" : "Senden"}</Button>
      </div>
    </Sheet>
  );
}
