// Mehrere Häfen: „Eingehend“ – Verbände und Ladungen auf dem Weg in den aktiven Hafen, die keine Bedrohung sind:
// eigene Verlegungen und Transporte aus anderen eigenen Häfen sowie Transporte anderer Spieler. Angriffe zeigt das
// Banner auf der Basis (rot); hier nur friedliche Ankünfte, klar als eigen bzw. fremd gekennzeichnet.
import type { BaseData } from "../lib/trpc.ts";
import { isThreat, TRANSFER } from "../lib/expansion.ts";
import { fmtDuration } from "../lib/time.ts";
import { Icon } from "../icons.tsx";
import { Badge, Card, UnitChips } from "../ui.tsx";

type In = BaseData["incoming"][number];

function title(i: In): string {
  if (i.type === TRANSFER) return "Eigene Verlegung";
  return i.own ? "Eigener Transport" : "Transport";
}

export function IncomingCard({ base, now }: { base: BaseData; now: number }) {
  const list = base.incoming.filter((i) => !isThreat(i)).sort((a, b) => a.arriveAtMs - b.arriveAtMs);
  if (list.length === 0) return null;
  return (
    <Card title={`Eingehend (${list.length})`}>
      <ul className="divide-y divide-rule">
        {list.map((i) => (
          <li key={i.id} className="py-2 text-sm flex gap-3">
            <Icon id={i.type === TRANSFER ? TRANSFER : "transport"} size={32} />
            <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-2">
                <strong>{title(i)}{i.from ? ` von ${i.from}` : ""}</strong>
                {i.own ? <Badge tone="sea">eigen</Badge> : <Badge>fremd</Badge>}
              </div>
              {i.units && Object.values(i.units).some((v) => v > 0) && <div className="text-xs text-ink2"><UnitChips counts={i.units} /></div>}
              {i.cargo && Object.values(i.cargo).some((v) => v > 0) && <div className="text-xs text-messing">Ladung: <UnitChips counts={i.cargo} /></div>}
              <div className="text-xs text-ink2">Ankunft in <span className="mono">{fmtDuration(i.arriveAtMs - now)}</span></div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
