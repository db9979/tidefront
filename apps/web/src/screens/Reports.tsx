import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { Button, Card, CountsLine, Loading } from "../ui.tsx";

type Counts = Record<string, number>;
interface Phase {
  phase: string;
  skipped: boolean;
  skipReason: string | null;
  rounds: number;
  before: { attacker: Counts; defender: Counts };
  after: { attacker: Counts; defender: Counts };
  entscheidend: string | null;
  entscheidendSide: "attacker" | "defender" | null;
}
interface Outcome { before: Counts; survivors: Counts; losses: Counts; returned: Counts; final: Counts }
interface Battle {
  winner: "attacker" | "defender";
  airSuperiority: "attacker" | "defender" | null;
  landed: boolean;
  phases: Phase[];
  attacker: Outcome;
  defender: Outcome;
  loot: Counts;
  wreck: Counts;
}

const SKIP: Record<string, string> = {
  no_fighters: "keine Jäger", no_opponent: "kein Gegner", no_bombers: "keine Bomber", no_targets: "keine Ziele",
  no_ships: "keine Schiffe", no_landing_ships: "keine Landungsschiffe", no_troops: "keine Truppen",
};

export function ReportsScreen() {
  const [open, setOpen] = useState<number | null>(null);
  const list = useQuery(trpc.report.list.queryOptions());
  if (open !== null) return <ReportDetail id={open} onBack={() => setOpen(null)} />;
  if (!list.data) return <Loading />;
  return (
    <div>
      <h1 className="text-xl font-bold mb-3">Berichte</h1>
      {list.data.length === 0 && <p className="text-slate-400">Noch keine Berichte.</p>}
      <ul className="space-y-2">
        {list.data.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(r.id)} className="tap w-full text-left rounded-xl bg-navy-800 border border-navy-700 p-3">
              <div className="flex justify-between gap-2">
                <strong className="min-w-0">{r.title}</strong>
                {r.won !== null && <span className={r.won ? "text-emerald-300" : "text-red-300"}>{r.won ? "Sieg" : "Niederlage"}</span>}
              </div>
              <div className="text-xs text-slate-400">{fmtTime(r.atMs)} · {label(r.kind)} · {r.role === "attacker" ? "Angreifer" : "Verteidiger"}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Diff({ before, after }: { before: Counts; after: Counts }) {
  const ids = Object.keys(before).filter((id) => (before[id] ?? 0) > 0);
  if (ids.length === 0) return <span className="text-slate-400">–</span>;
  return (
    <ul>
      {ids.map((id) => {
        const lost = before[id] - (after[id] ?? 0);
        return (
          <li key={id}>
            {label(id)}: {fmtNum(before[id])} → {fmtNum(after[id] ?? 0)}
            {lost > 0 && <span className="text-red-300"> (−{fmtNum(lost)})</span>}
          </li>
        );
      })}
    </ul>
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
        <h1 className="text-lg font-bold min-w-0">{r.title}</h1>
        <Button kind="secondary" onClick={onBack}>Zurück</Button>
      </div>
      <p className="text-xs text-slate-400 mb-3">{fmtTime(r.atMs)}{r.seed !== null ? ` · Seed ${r.seed} · Balance ${r.balanceVersion}` : ""}</p>
      {d.battle ? <BattleView b={d.battle as Battle} names={[String(d.attackerName), String(d.defenderName)]} role={r.role} /> : null}
      {d.scout ? <ScoutView s={d.scout as Record<string, unknown>} owner={String(d.owner ?? "")} /> : null}
      {d.nest ? <NestScout n={d.nest as { level: number; empty: boolean; garrison: { units: Counts; defenses: Counts; loot: Counts } | null }} /> : null}
      {r.kind === "transport" && (
        <Card title="Transport">
          <p>Von {String(d.from)} an {String(d.to)}</p>
          <p className="text-sm"><CountsLine counts={d.cargo as Counts} /></p>
        </Card>
      )}
      {r.kind === "leer" && <Card><p>Das Nest war bei Ankunft verlassen. Der Verband kehrt um.</p></Card>}
    </div>
  );
}

function BattleView({ b, names, role }: { b: Battle; names: [string, string]; role: "attacker" | "defender" }) {
  const won = (b.winner === "attacker") === (role === "attacker");
  return (
    <>
      <div className={`rounded-xl p-3 mb-3 ${won ? "bg-emerald-900/60 border border-emerald-600" : "bg-red-900/60 border border-red-600"}`}>
        <strong>{won ? "Sieg" : "Niederlage"}</strong> – Angreifer {names[0]}, Verteidiger {names[1]}
        <div className="text-xs">
          Luftüberlegenheit: {b.airSuperiority === null ? "keine" : b.airSuperiority === "attacker" ? names[0] : names[1]} · Landung: {b.landed ? "ja" : "nein"}
        </div>
      </div>
      {b.phases.map((p) => (
        <Card key={p.phase} title={label(p.phase)} right={<span className="text-xs text-slate-400">{p.skipped ? `entfallen (${SKIP[p.skipReason ?? ""] ?? p.skipReason})` : `${p.rounds} Runden`}</span>}>
          {!p.skipped && (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><div className="text-sea-300 mb-1">{names[0]}</div><Diff before={p.before.attacker} after={p.after.attacker} /></div>
                <div><div className="text-sea-300 mb-1">{names[1]}</div><Diff before={p.before.defender} after={p.after.defender} /></div>
              </div>
              {p.entscheidend && (
                <p className="text-xs mt-2 text-brass-400">
                  Entscheidend: {label(p.entscheidend)} ({p.entscheidendSide === "attacker" ? names[0] : names[1]})
                </p>
              )}
            </>
          )}
        </Card>
      ))}
      <Card title="Ergebnis">
        <div className="text-sm space-y-1">
          <div><span className="text-slate-400">Beute:</span> <CountsLine counts={b.loot} /></div>
          <div><span className="text-slate-400">Wrackfeld:</span> <CountsLine counts={b.wreck} /></div>
          <div><span className="text-slate-400">Verluste {names[0]}:</span> <CountsLine counts={b.attacker.losses} /></div>
          <div><span className="text-slate-400">Rückkehrer {names[0]}:</span> <CountsLine counts={b.attacker.returned} /></div>
          <div><span className="text-slate-400">Verluste {names[1]}:</span> <CountsLine counts={b.defender.losses} /></div>
          <div><span className="text-slate-400">Lazarett/Reparatur {names[1]}:</span> <CountsLine counts={b.defender.returned} /></div>
        </div>
      </Card>
    </>
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
