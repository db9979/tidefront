// Lagezentrum: eine Zeile (antippbar, Symbol, Text, zweite Zeile, Countdown, Fortschritt) und eine Gruppe mit Kopf.
import type { ReactNode } from "react";
import { Icon } from "../../icons.tsx";
import { fmtDuration, serverNow } from "../../lib/time.ts";
import type { Outputs } from "../../lib/trpc.ts";

export type LageRow = Outputs["lage"]["get"]["soon"][number];
export type LageJump = NonNullable<LageRow["jump"]>;

/** Uhrzeit (Spielzeit wie fmtTime), am selben Tag nur HH:MM, sonst mit Datum. */
export function clockOf(ms: number, nowMs: number): string {
  const off = serverNow() - Date.now();
  const d = new Date(ms - off);
  const sameDay = d.toDateString() === new Date(nowMs - off).toDateString();
  return sameDay
    ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Gruppe mit Kopf; action steht rechts in der Kopfzeile (z. B. „Alle abholen“, UX 0.43 A1). */
export function LageGroup({ title, count, testId, action, tone, children }: { title: string; count?: number; testId: string; action?: ReactNode; tone?: "alarm"; children: ReactNode }) {
  return (
    <section className={`panel rounded-xl p-3.5 mb-3 ${tone === "alarm" ? "border-siegel border-l-4" : ""}`} data-testid={testId} aria-label={title}>
      <div className="flex items-center gap-2 mb-1 min-h-8">
        <h2 className={`font-display text-[11px] uppercase tracking-[0.16em] flex items-center gap-2 flex-1 min-w-0 ${tone === "alarm" ? "text-siegel" : "text-ink2"}`}>
          {title}{count !== undefined && count > 0 && <span className="mono normal-case tracking-normal">{count}</span>}
        </h2>
        {action}
      </div>
      <ul>{children}</ul>
    </section>
  );
}

/** Eine Zeile; past: Zeitpunkt liegt zurück (Zuletzt passiert: „vor …“ statt Countdown). */
export function LageLine({ row, nowMs, onJump, onTap, past, unread }: { row: LageRow; nowMs: number; onJump: (j: LageJump) => void; onTap?: () => void; past?: boolean; unread?: boolean }) {
  const alarm = row.tone === "alarm";
  const good = row.tone === "gut";
  const p = row.progress;
  const share = p ? Math.max(0, Math.min(1, (nowMs - p.fromMs) / Math.max(1, p.toMs - p.fromMs))) : null;
  const body = (
    <>
      <span className="shrink-0 mt-0.5"><Icon id={row.icon} size={24} /></span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm leading-snug ${alarm ? "text-siegel font-semibold" : good ? "text-moos font-semibold" : ""} ${unread ? "font-semibold" : ""}`}>
          {unread && <span className="inline-block w-2 h-2 rounded-full bg-siegel mr-1.5 align-middle" aria-label="neu" />}
          <span data-lage-text>{row.text}</span>
        </span>
        {row.sub && <span className="block text-xs text-ink2 truncate">{row.sub}</span>}
        {share !== null && (
          <span className="block mt-1 h-1.5 rounded-full bg-inset overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Fortschritt">
            <span className={`block h-full ${alarm ? "bg-siegel" : "bg-see"}`} style={{ width: `${share * 100}%` }} />
          </span>
        )}
      </span>
      {row.atMs !== null && (
        <span className="text-right leading-tight shrink-0">
          {!past && <span className={`block mono text-[13px] ${alarm ? "text-siegel" : ""}`}>{row.atMs <= nowMs ? "jetzt" : fmtDuration(row.atMs - nowMs)}</span>}
          <span className="block mono text-[11px] text-ink2">{clockOf(row.atMs, nowMs)}</span>
        </span>
      )}
    </>
  );
  const cls = "flex items-start gap-2.5 py-2 w-full text-left";
  return (
    <li className="border-b border-dotted border-rule last:border-b-0" data-lage-row={row.kind} data-lage-key={row.key}>
      {row.jump || onTap ? (
        <button type="button" className={`tap ${cls}`} onClick={() => (onTap ? onTap() : onJump(row.jump!))}>{body}</button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
