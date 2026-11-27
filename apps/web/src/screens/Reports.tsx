import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { Button, Card, CountsLine, Loading, BackButton } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import { BattleLog, type Battle } from "../components/BattleLog.tsx";
import { RepeatButton } from "../components/Repeat.tsx";
import { WorldEventReportNote } from "../components/WorldEvents.tsx";
import { useBackLayer } from "../lib/back.ts";
import { SabotageReport, SpyReport } from "../components/Intel.tsx";
import { AdmiralReport } from "../components/Admirals.tsx"; // Admirale
import { AllianceOpsReport } from "../components/AllianceOps.tsx"; // Allianz-Ops

const KIND_ICON: Record<string, string> = { ueberfall: "ueberfall", kartell: "kartell", aufklaerung: "aufklaerung", transport: "transport", leer: "kartell", abgewiesen: "schild", weltereignis: "kartell", weltereignis_leer: "kartell", spionage: "spionage", sabotage: "sabotage", sammelangriff: "sammelangriff", minen: "mine", blockade: "blockade", blockadekampf: "blockade", konvoi: "konvoi" };
import { NavalReport } from "../components/Naval.tsx"; // See: Minen/Blockade/Konvoi
import { FieldReport } from "../components/Fields.tsx"; // Felder
import { HScroll } from "../components/HScroll.tsx";
const NAVAL_KINDS = ["minen", "blockade", "blockadekampf", "konvoi"]; // See: kein „Wiederholen“

type Counts = Record<string, number>;

/** Filter-Chips der Berichtsliste; unbekannte Arten landen in „Sonstiges“. */
type Filter = "alle" | "kampf" | "aufklaerung" | "handel" | "sonstiges";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "alle", label: "Alle" },
  { id: "kampf", label: "Kämpfe" },
  { id: "aufklaerung", label: "Aufklärung" },
  { id: "handel", label: "Handel" },
  { id: "sonstiges", label: "Sonstiges" },
];
const KIND_FILTER: Record<string, Filter> = {
  ueberfall: "kampf", kartell: "kampf", leer: "kampf", abgewiesen: "kampf", weltereignis: "kampf", weltereignis_leer: "kampf",
  sammelangriff: "kampf", blockadekampf: "kampf", konvoi: "kampf",
  aufklaerung: "aufklaerung", spionage: "aufklaerung", sabotage: "aufklaerung",
  transport: "handel",
};
const filterOf = (kind: string): Filter => KIND_FILTER[kind] ?? "sonstiges";
/** Berichte je Seite; „Weitere laden“ hängt die nächsten an. */
const PAGE = 20;

/** Zeile unter dem Titel: aus Sicht des Lesers. */
function roleText(role: string, kind: string): string {
  if (kind === "sammelangriff") return role === "defender" ? "Sammelangriff auf dich" : "Sammelangriff deiner Allianz"; // Allianz-Ops
  if (role === "recipient") return "Lieferung an dich";
  if (role === "defender") return "Angriff auf dich";
  if (kind === "transport") return "eigene Lieferung";
  if (kind === "aufklaerung") return "eigene Aufklärung";
  if (kind === "spionage") return "eigener Spionageauftrag";
  return "eigene Mission";
}

export function ReportsScreen() {
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("alle");
  const [limit, setLimit] = useState(PAGE);
  const list = useQuery(trpc.report.list.queryOptions());
  // Zurück-Taste schließt den geöffneten Bericht.
  useBackLayer(open !== null, () => setOpen(null), 2);
  if (open !== null) return <ReportDetail id={open} onBack={() => setOpen(null)} />;
  if (!list.data) return <Loading />;
  const matching = list.data.filter((r) => filter === "alle" || filterOf(r.kind) === filter);
  const count = (f: Filter) => f === "alle" ? list.data.length : list.data.filter((r) => filterOf(r.kind) === f).length;
  return (
    <div>
      {list.data.length > 0 && (
        <div className="mb-2"><HScroll className="gap-1.5" role="radiogroup" label="Berichte filtern" watch={filter}>
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} onClick={() => { setFilter(f.id); setLimit(PAGE); }}
              className={`tap shrink-0 rounded-full border px-3 text-[13px] ${filter === f.id ? "bg-ink text-paper border-ink" : "bg-card text-ink2 border-rule"}`}>
              {f.label} <span className="mono text-[11px] opacity-75">{count(f.id)}</span>
            </button>
          ))}
        </HScroll></div>
      )}
      {list.data.length === 0 && (
        <div className="panel rounded-xl p-5 text-center text-ink2">
          <Icon id="nav-bericht" size={48} className="mx-auto mb-2 text-slate-500" />
          Noch keine Berichte. Nach jedem Kampf, jeder Aufklärung und jedem Transport erscheint hier ein Bericht.
        </div>
      )}
      <ul className="space-y-2">
        {matching.slice(0, limit).map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(r.id)} className={`tap w-full text-left panel rounded-xl p-3 flex items-center gap-3 border-l-4 ${r.won === null ? "!border-l-see" : r.won ? "!border-l-moos" : "!border-l-siegel"}`}>
              <Icon id={KIND_ICON[r.kind] ?? "nav-bericht"} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2">
                  <strong className="min-w-0 truncate font-serif font-semibold text-[15px]">{r.title}</strong>
                  {r.won !== null && <span className={`font-display text-[10.5px] uppercase ${r.won ? "text-moos" : "text-siegel"}`}>{r.won ? "Sieg" : "Niederlage"}</span>}
                </div>
                <div className="text-xs text-slate-400">{fmtTime(r.atMs)} · {roleText(r.role, r.kind)}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {list.data.length > 0 && matching.length === 0 && <p className="text-sm text-ink2 text-center py-4">Keine Berichte in dieser Auswahl.</p>}
      {matching.length > limit && (
        <Button kind="secondary" className="w-full mt-3" onClick={() => setLimit((n) => n + PAGE)}>Weitere laden ({matching.length - limit})</Button>
      )}
    </div>
  );
}

function ReportDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const q = useQuery(trpc.report.get.queryOptions({ id }));
  if (!q.data) return q.isLoading ? <Loading /> : <p>Bericht nicht gefunden.</p>;
  const r = q.data;
  const d = r.data as Record<string, unknown>;
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2">
        <h1 className="font-serif text-xl leading-tight min-w-0">{r.title}</h1>
        <BackButton onClick={onBack} />
      </div>
      <p className="text-xs mono text-slate-400 mb-3">{fmtTime(r.atMs)}</p>
      {r.role === "attacker" && r.kind !== "kartell" && r.kind !== "spionage" && r.kind !== "sammelangriff" && !d.allianceRaid && !r.kind.startsWith("weltereignis") && !NAVAL_KINDS.includes(r.kind) && r.kind !== "feld" && <RepeatButton reportId={r.id} />}
      {d.field ? <FieldReport d={d.field as Parameters<typeof FieldReport>[0]["d"]} /> : null}{/* Felder */}
      {NAVAL_KINDS.includes(r.kind) && <NavalReport kind={r.kind} d={d} />}
      {r.kind.startsWith("weltereignis") && <WorldEventReportNote kind={r.kind} data={d} />}
      {r.kind === "spionage" && d.spy ? <SpyReport d={d} role={r.role} /> : null}
      {r.kind === "sabotage" && d.sabotage ? <SabotageReport d={d} /> : null}
      {d.battle && r.kind !== "spionage" ? (
        <BattleLog
          b={d.battle as Battle}
          names={[String(d.attackerName), String(d.defenderName)]}
          role={r.role === "attacker" ? "attacker" : "defender"}
          protectedPerResource={typeof d.protectedPerResource === "number" ? d.protectedPerResource : null}
          salvage={d.salvage && typeof d.salvage === "object" ? (d.salvage as Counts) : null}
        />
      ) : null}
      {d.admirals ? <AdmiralReport d={d.admirals as Parameters<typeof AdmiralReport>[0]["d"]} names={[String(d.attackerName), String(d.defenderName)]} /> : null}
      <AllianceOpsReport d={d} />
      {d.scout && r.kind !== "spionage" ? <ScoutView s={d.scout as Record<string, unknown>} owner={String(d.owner ?? "")} /> : null}
      {d.nest ? <NestScout n={d.nest as { level: number; empty: boolean; garrison: { units: Counts; defenses: Counts; loot: Counts } | null }} /> : null}
      {r.kind === "transport" && (
        <Card title={r.role === "recipient" ? "Lieferung erhalten" : "Transport"}>
          <p>{r.role === "recipient" ? `${String(d.from)} hat deinem Hafen ${String(d.to)} geliefert:` : `Von ${String(d.from)} an ${String(d.to)}`}</p>
          <p className="text-sm"><CountsLine counts={d.cargo as Counts} /></p>
        </Card>
      )}
      {r.kind === "abgewiesen" && (
        <Card>
          <p>Ein Verband des Kartells erreichte deinen Hafen, traf aber auf deinen Schutz ({label(String(d.reason ?? "nachtschild"))}) und drehte ohne Kampf ab.</p>
        </Card>
      )}
      {r.kind === "leer" && <Card><p>Das Nest war bei Ankunft verlassen. Der Verband kehrt um.</p></Card>}
      {r.seed !== null && (
        <details className="mt-3 text-xs text-slate-400">
          <summary className="cursor-pointer min-h-[44px] flex items-center">Technische Angaben</summary>
          <p className="mono">Seed {r.seed} · Balance {r.balanceVersion}</p>
        </details>
      )}
    </div>
  );
}

function ScoutView({ s, owner }: { s: Record<string, unknown>; owner: string }) {
  return (
    <Card title={`Lagebild${owner ? ` (${owner})` : ""}`}>
      <div className="text-sm space-y-1">
        <div><span className="text-slate-400">Bestände:</span> <CountsLine counts={s.resources as Counts} /></div>
        <div><span className="text-slate-400">Bunkerschutz:</span> {fmtNum(Number(s.protectedPerResource ?? 0))} je Ressource</div>
        <div><span className="text-slate-400">Einheiten:</span> <CountsLine counts={s.units as Counts} /></div>
        <div><span className="text-slate-400">Anlagen:</span> <CountsLine counts={s.defenses as Counts} /></div>
        <div><span className="text-slate-400">Gebäude:</span> {Object.entries(s.buildings as Counts).filter(([, l]) => l > 0).map(([id, l]) => `${label(id)} ${l}`).join(", ") || "–"}</div>
        {s.uncertain ? <div className="text-xs text-red-300">Sichtung unsicher – Nebel am Ziel ({Math.round(Number((s.uncertain as { fog: number }).fog) * 100)} %): Bestände, Einheiten und Anlagen nur {(s.uncertain as { heavy: boolean }).heavy ? "grob " : ""}gerundet, Gebäude genau.</div> : null}
      </div>
    </Card>
  );
}

function NestScout({ n }: { n: { level: number; empty: boolean; garrison: { units: Counts; defenses: Counts; loot: Counts } | null } }) {
  return (
    <Card title={`Piratennest Stufe ${n.level}`}>
      {n.empty || !n.garrison ? (
        <p>Das Nest ist verlassen.</p>
      ) : (
        <div className="text-sm space-y-1">
          <div><span className="text-slate-400">Besatzung:</span> <CountsLine counts={n.garrison.units} /></div>
          <div><span className="text-slate-400">Anlagen:</span> <CountsLine counts={n.garrison.defenses} /></div>
          <div><span className="text-slate-400">Beute:</span> <CountsLine counts={n.garrison.loot} /></div>
        </div>
      )}
    </Card>
  );
}
