// „Wiederholen“: öffnet die Missionsplanung mit demselben Ziel und derselben Zusammensetzung
// (an eigenen Berichten und an zuletzt heimgekehrten Missionen).
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { errorText, label } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { isPlanType, requestPlan } from "../lib/plan-request.ts";
import { Icon } from "../icons.tsx";
import { Button, Card, UnitChips } from "../ui.tsx";

function repeat(r: { type: string; col: number; row: number; units: Record<string, number> }) {
  requestPlan({ target: { col: r.col, row: r.row }, type: isPlanType(r.type) ? r.type : undefined, units: r.units });
}

/** Knopf an einem eigenen Bericht; erscheint nur, wenn es die zugehörige Mission gibt. */
export function RepeatButton({ reportId }: { reportId: number }) {
  const q = useQuery(trpc.comfort.repeat.queryOptions({ reportId }));
  if (!q.data) return null;
  const r = q.data;
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Icon id={r.type} size={32} />
        <div className="text-sm flex-1 min-w-0">
          Gleicher Verband, gleiches Ziel (Feld {r.col}/{r.row}).
          {r.blocked && <div className="text-xs text-red-300">Nicht möglich: {errorText(r.blocked)}</div>}
          {!r.blocked && r.fit.short.length > 0 && <div className="text-xs text-messing">Nicht alles daheim – die Planung kürzt auf Verfügbares.</div>}
        </div>
        <Button disabled={!!r.blocked} onClick={() => repeat(r)}>Wiederholen</Button>
      </div>
    </Card>
  );
}

/** Truppen: zuletzt heimgekehrte Missionen mit „Wiederholen“. */
export function RecentMissions() {
  const q = useQuery(trpc.comfort.recentMissions.queryOptions());
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card title="Zuletzt heimgekehrt">
      <ul className="divide-y divide-rule">
        {rows.map((m) => (
          <li key={m.id} className="py-2 flex items-center gap-3 text-sm">
            <Icon id={m.type} size={32} />
            <div className="flex-1 min-w-0">
              <div><strong>{label(m.type)}</strong> · Feld {m.col}/{m.row}{m.recalled ? " · zurückgerufen" : ""}</div>
              <div className="text-xs"><UnitChips counts={m.units} /></div>
              <div className="text-xs text-ink2">zurück {fmtTime(m.returnedAtMs)}</div>
              {m.blocked && <div className="text-xs text-red-300">Nicht möglich: {errorText(m.blocked)}</div>}
            </div>
            <Button kind="secondary" disabled={!!m.blocked} onClick={() => repeat(m)}>Wiederholen</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
