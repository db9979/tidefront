// Zeitleiste der nächsten Ereignisse auf der Basis: kompakt, chronologisch, mit laufenden Countdowns.
// Alles kommt aus base.get (Bau, Ausbildung, Missionen, Angriffe, Lieferungen, Schutz) und season.current.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { isThreat, TRANSFER } from "../lib/expansion.ts"; // Mehrere Häfen
import { fmtAt, fmtDuration, useNow } from "../lib/time.ts";
import { Icon } from "../icons.tsx";
import { Card, SmallButton } from "../ui.tsx";

const DAY_MS = 86400000;
const SHOWN = 6;

interface Item {
  key: string;
  atMs: number;
  icon: string;
  text: string;
  alert?: boolean;
}

export function timelineItems(base: BaseData, nowMs: number, opts: { seasonEndMs?: number | null; beginnerDays?: number }): Item[] {
  const out: Item[] = [];
  for (const o of base.buildQueue) {
    out.push({ key: `b:${o.buildingId}:${o.targetLevel}`, atMs: o.finishesAt, icon: o.buildingId, text: `${label(o.buildingId)} Stufe ${o.targetLevel}` });
  }
  for (const o of base.trainingQueue) {
    out.push({ key: `t:${o.builtIn}:${o.id}:${o.finishesAt}`, atMs: o.finishesAt, icon: o.id, text: `${fmtNum(o.count)} × ${label(o.id)} ausgebildet` });
  }
  for (const m of base.missions) {
    if (m.status === "outbound") out.push({ key: `ma:${m.id}`, atMs: m.arriveAtMs, icon: m.type, text: `${label(m.type)}: Ankunft Feld ${m.target.col}/${m.target.row}` });
    out.push({ key: `mr:${m.id}`, atMs: m.returnAtMs, icon: m.type, text: m.type === "spionage" ? "Spione zurück" : `${label(m.type)}: Verband zurück` });
  }
  for (const i of base.incoming) {
    const attack = isThreat(i);
    // Mehrere Häfen: eigene Verlegung/eigener Transport aus einem anderen Hafen (keine Warnung).
    const own = i.own ? (i.type === TRANSFER ? "Eigene Verlegung" : "Eigener Transport") : "Transport";
    out.push({
      key: `i:${i.id}`, atMs: i.arriveAtMs, icon: i.type === "kartell" ? "kartell" : attack ? "ueberfall" : i.type === TRANSFER ? TRANSFER : "transport",
      text: attack ? `${label(i.type)}: Angriff trifft ein` : i.from ? `${own} von ${i.from} trifft ein` : `${own} trifft ein`, alert: attack,
    });
  }
  for (const d of base.deliveries) {
    out.push({ key: `d:${d.id}`, atMs: d.arriveAtMs, icon: d.resource, text: `Lieferung: ${fmtNum(d.qty)} ${label(d.resource)}` });
  }
  const p = base.protection;
  const w = p.nightWindow;
  if (w) {
    if (nowMs < w.startMs) out.push({ key: "n:start", atMs: w.startMs, icon: "schild", text: "Nachtschild beginnt" });
    else if (nowMs < w.endMs) out.push({ key: "n:end", atMs: w.endMs, icon: "schild", text: "Nachtschild endet" });
  }
  if (p.status === "anfaengerschutz" && opts.beginnerDays) {
    out.push({ key: "p:beginner", atMs: p.createdAtMs + opts.beginnerDays * DAY_MS, icon: "schild", text: "Anfängerschutz endet" });
  }
  if (p.defeatShieldUntilMs > nowMs) out.push({ key: "p:defeat", atMs: p.defeatShieldUntilMs, icon: "schild", text: "Schutz nach Niederlage endet" });
  if (opts.seasonEndMs) out.push({ key: "s:end", atMs: opts.seasonEndMs, icon: "nav-bericht", text: "Saisonende" });
  return out.filter((i) => i.atMs > nowMs - 5000).sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));
}

/** limit: so viele Einträge zugeklappt (Basis: 2), „mehr“ zeigt alle. */
export function Timeline({ base, limit = SHOWN }: { base: BaseData; limit?: number }) {
  const now = useNow();
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const season = useQuery({ ...trpc.season.current.queryOptions(), staleTime: 300000 });
  const [all, setAll] = useState(false);
  const items = timelineItems(base, now, { seasonEndMs: season.data?.season?.endsAtMs ?? null, beginnerDays: meta.data?.balance.protection.beginnerDays });
  const shown = all ? items : items.slice(0, limit);
  return (
    <Card title="Als Nächstes" right={items.length > limit ? <SmallButton className="-my-3" onClick={() => setAll(!all)}>{all ? "Weniger" : `Mehr (${items.length})`}</SmallButton> : undefined}>
      {items.length === 0 ? (
        <p className="text-sm text-ink2">Nichts geplant. Baue aus, bilde aus oder schicke einen Verband los.</p>
      ) : (
        <ol className="relative">
          {shown.map((i, k) => (
            <li key={i.key} className="flex items-center gap-2.5 py-1.5 border-b border-dotted border-rule last:border-b-0">
              <span className={`relative shrink-0 ${k === 0 ? "" : "opacity-90"}`}><Icon id={i.icon} size={24} /></span>
              <span className={`flex-1 min-w-0 text-sm truncate ${i.alert ? "text-siegel font-semibold" : ""}`}>{i.text}</span>
              <span className="text-right leading-tight">
                <span className={`block mono text-[13px] ${i.alert ? "text-siegel" : ""}`}>{i.atMs <= now ? "jetzt" : fmtDuration(i.atMs - now)}</span>
                <span className="block mono text-[11px] text-ink2">{fmtAt(i.atMs, now)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
