// „Wiederholen“: öffnet die Missionsplanung mit demselben Ziel und derselben Zusammensetzung
// (an eigenen Berichten und an zuletzt heimgekehrten Missionen).
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { errorText, label } from "../lib/names.ts";
import { ReasonLine } from "./Remedy.tsx"; // „Was hilft?“
import { fmtTime } from "../lib/time.ts";
import { isPlanType, requestPlan } from "../lib/plan-request.ts";
import { Icon } from "../icons.tsx";
import { Button, Card, UnitChips } from "../ui.tsx";
import { useNav } from "../lib/nav.ts";
import { setTrainPreset } from "../lib/train-request.ts"; // „Verluste ersetzen“ → Ausbilden vorbelegt

function repeat(r: { type: string; col: number; row: number; units: Record<string, number> }) {
  requestPlan({ target: { col: r.col, row: r.row }, type: isPlanType(r.type) ? r.type : undefined, units: r.units });
}

/** Eigene Verluste eines Kampfberichts (Verluste ohne Heimkehrer); leer ohne Kampf. */
export function ownLosses(data: Record<string, unknown>, role: string): Record<string, number> {
  const b = data.battle as { attacker?: { losses?: Record<string, number>; returned?: Record<string, number> }; defender?: { losses?: Record<string, number>; returned?: Record<string, number> } } | undefined;
  const side = role === "attacker" ? b?.attacker : b?.defender;
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(side?.losses ?? {})) {
    const lost = n - (side?.returned?.[id] ?? 0);
    if (lost > 0) out[id] = lost;
  }
  return out;
}

/**
 * Knopf an einem eigenen Bericht; erscheint nur, wenn es die zugehörige Mission gibt. UX 0.43 (U-5): dazu
 * „Verluste ersetzen“ – öffnet Truppen → Ausbilden mit den verlorenen Einheiten vorbelegt.
 */
export function RepeatButton({ reportId, losses = {} }: { reportId: number; losses?: Record<string, number> }) {
  const q = useQuery(trpc.comfort.repeat.queryOptions({ reportId }));
  const nav = useNav();
  if (!q.data) return null;
  const r = q.data;
  const lost = Object.keys(losses).length > 0;
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Icon id={r.type} size={32} />
        <div className="text-sm flex-1 min-w-0">
          Gleicher Verband, gleiches Ziel (Feld {r.col}/{r.row}).
          {r.blocked && <ReasonLine code={r.blocked} text={`Nicht möglich: ${errorText(r.blocked)}`} className="text-xs text-red-300" />}
          {!r.blocked && r.fit.short.length > 0 && <div className="text-xs text-messing">Nicht alles daheim – die Planung kürzt auf Verfügbares.</div>}
        </div>
        <Button disabled={!!r.blocked} onClick={() => repeat(r)}>Wiederholen</Button>
      </div>
      {lost && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dotted border-rule">
          <span className="text-xs text-ink2 flex-1 min-w-0">Verloren: <UnitChips counts={losses} /></span>
          <Button kind="secondary" className="whitespace-nowrap" onClick={() => { setTrainPreset(losses); nav.go({ to: "troops", seg: "ausbilden" }); }}>Verluste ersetzen</Button>
        </div>
      )}
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
              {m.blocked && <ReasonLine code={m.blocked} text={`Nicht möglich: ${errorText(m.blocked)}`} detail={{ units: m.units }} className="text-xs text-red-300" />}
            </div>
            <Button kind="secondary" disabled={!!m.blocked} onClick={() => repeat(m)}>Wiederholen</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
