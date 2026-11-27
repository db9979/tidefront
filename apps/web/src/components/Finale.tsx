// Saisonfinale „Leviathan“: Banner (Ankündigung und laufende Armada), Info-Blatt auf der Karte mit Lebensbalken und
// Abschnitten, Vorschau beim Planen (Abschnitt, Siegchance, Beute), Eintrag in der Ruhmeshalle.
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtTime, useNow } from "../lib/time.ts";
import { Button, CountsLine } from "../ui.tsx";
import type { WorldEventInfo } from "./WorldEvents.tsx";

type FinaleInfo = NonNullable<WorldEventInfo["finale"]>;

function resLine(m: Record<string, number> | null | undefined): string {
  const parts = Object.entries(m ?? {}).filter(([, v]) => v > 0).map(([r, v]) => `${fmtNum(v)} ${label(r)}`);
  return parts.length > 0 ? parts.join(", ") : "–";
}

/** Lebensbalken: Geschwader (durchgehend) und Flaggschiff (je Sektion ein Segment). */
export function FinaleLifeBar({ f }: { f: FinaleInfo }) {
  const pct = f.initialHp > 0 ? Math.round((f.remainingHp / f.initialHp) * 100) : 100;
  const boats = f.initialBoats > 0 ? f.boats / f.initialBoats : 0;
  const shown = Math.min(f.initialSections, 40);
  const per = f.initialSections > 0 ? f.initialSections / shown : 1;
  return (
    <div className="space-y-1" data-testid="finale-lifebar">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink2">Lebenspunkte</span>
        <span className="mono">{fmtNum(f.remainingHp)} / {fmtNum(f.initialHp)} ({pct} %)</span>
      </div>
      <div className="text-[11px] text-ink2">Geschwader: {fmtNum(f.boats)} von {fmtNum(f.initialBoats)} Schnellbooten</div>
      <div className="h-2 rounded bg-navy-950 border border-navy-600 overflow-hidden" role="meter" aria-label="Geschwader" aria-valuenow={Math.round(boats * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-siegel" style={{ width: `${Math.round(boats * 100)}%` }} />
      </div>
      <div className="text-[11px] text-ink2">Flaggschiff „Leviathan“: {f.sections} von {f.initialSections} Sektionen zu {fmtNum(f.sectionHp)} LP{f.flagshipOpen ? " – jetzt angreifbar" : " – erst nach den Geschwadern"}</div>
      <div className="flex gap-[2px]" aria-label="Sektionen des Flaggschiffs">
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className={`h-2 flex-1 rounded-sm ${i * per < f.sections ? "bg-messing" : "bg-navy-950 border border-navy-600"}`} />
        ))}
      </div>
    </div>
  );
}

/** Info-Blatt (Kartenpanel) für das Finale. */
export function FinaleCard({ e, onPlan }: { e: WorldEventInfo; onPlan: () => void }) {
  const now = useNow();
  const f = e.finale!;
  const ended = e.status === "ended";
  const time = ended ? (e.outcome === "defeated" ? `versenkt${e.winner ? ` – letzter Schlag: ${e.winner}` : ""}` : "entkommen")
    : e.status === "announced" ? `erscheint in ${fmtDuration(e.activeAtMs - now)}` : `zieht ab in ${fmtDuration(e.endsAtMs - now)}`;
  return (
    <div className="mt-1" data-testid="finale-card">
      <div className="font-serif text-[19px] leading-tight">
        Saisonfinale: Kartell-Armada
        <em className="block text-[13px] text-siegel">{time}</em>
      </div>
      <p className="text-xs text-ink2 mt-1">
        Alle gegen das Kartell: Jeder Überfall trifft einen Abschnitt der Geschwader, halb so stark wie die Kriegsschiffe und Flugzeuge deines Verbands –
        auch kleine Häfen gewinnen ihren Abschnitt. Sind die Geschwader versenkt, liegt das Flaggschiff am Sammelpunkt; dagegen hilft ein Sammelangriff
        der Allianz. Beute je vernichtetem Lebenspunkt, ohne Laderaumgrenze (Gutschrift bei der Heimkehr).
      </p>
      {e.status === "announced" ? (
        <p className="text-xs mt-1"><span className="text-ink2">Erscheint: </span>{fmtTime(e.activeAtMs)} · bleibt bis {fmtTime(e.endsAtMs)}</p>
      ) : (
        <div className="mt-2"><FinaleLifeBar f={f} /></div>
      )}
      <div className="text-xs mt-1 space-y-0.5">
        {f.vanguards.length > 0 && <div><span className="text-ink2">Vorhuten: </span>{f.vanguards.map((v) => v.name).join(", ")} (Geschwader auch dort angreifbar)</div>}
        {f.alliances.length > 0 && <div><span className="text-ink2">Allianzen: </span>{f.alliances.map((a) => `[${a.tag}] ${fmtNum(a.hp)} LP`).join(", ")}</div>}
        {e.contributors.length > 0 && <div><span className="text-ink2">Schaden: </span>{e.contributors.slice(0, 6).map((c) => `${c.name}${c.own ? " (du)" : ""} ${fmtNum(c.hp)} LP`).join(", ")}</div>}
        {e.distanceKm !== null && <div className="text-ink2">Entfernung zu deinem Hafen etwa {fmtNum(e.distanceKm)} km</div>}
      </div>
      {!ended && <Button className="w-full mt-2" onClick={onPlan}>Angriff planen</Button>}
      {!ended && f.flagshipOpen && <p className="text-xs text-ink2 mt-1">Tipp: Im Planungsblatt unten „Sammelangriff öffnen“ – gemeinsam verliert ihr weniger und teilt den Schatz des Leviathan.</p>}
    </div>
  );
}

/** Banner auf der Basis: Ankündigung mit Countdown bzw. laufende Armada. */
export function FinaleBanner({ e, onMap }: { e: WorldEventInfo; onMap: () => void }) {
  const now = useNow();
  const f = e.finale!;
  const announced = e.status === "announced";
  return (
    <button type="button" onClick={onMap} data-testid="finale-banner" className="tap w-full text-left rounded-xl bg-red-950 border border-siegel border-l-4 p-3 text-sm">
      <strong className="text-siegel uppercase font-display text-xs">Saisonfinale: Kartell-Armada {announced ? "angekündigt" : "vor der Küste"}</strong>
      <div className="font-serif text-lg leading-tight">
        {announced ? <>erscheint in <span className="mono">{fmtDuration(e.activeAtMs - now)}</span></> : <>zieht ab in <span className="mono">{fmtDuration(e.endsAtMs - now)}</span></>}
      </div>
      <div className="text-xs text-ink2">
        {announced ? `Sammelpunkt Feld ${e.col}/${e.row}. Rüste Kriegsschiffe und Flugzeuge – ` : `Noch ${f.initialHp > 0 ? Math.round((f.remainingHp / f.initialHp) * 100) : 100} % Lebenspunkte. `}
        jeder Abschnitt bringt Beute, die Besten kommen in die Ruhmeshalle · auf der Karte zeigen
      </div>
    </button>
  );
}

/** Zusatz der Missionsvorschau (Antwort von missionPreview.finale). */
export interface FinalePreviewData {
  k: number;
  sector: Record<string, number> | null;
  flagship: boolean;
  winRate: number | null;
  damageHp: number;
  loot: Record<string, number>;
  treasure: Record<string, number> | null;
  point: string;
}

export function FinalePreview({ p }: { p: FinalePreviewData }) {
  if (!p.sector) return <div className="text-xs text-ink2" data-testid="finale-preview">Die Armada ist noch nicht erschienen.</div>;
  const chance = Math.round((p.winRate ?? 0) * 100);
  return (
    <div className="text-xs space-y-0.5 mt-1" data-testid="finale-preview">
      <div><span className="text-ink2">Ziel: </span>{p.point}</div>
      <div><span className="text-ink2">Dein Abschnitt{p.flagship ? " (Flaggschiff)" : ""}: </span><CountsLine counts={p.sector} /> <span className="text-ink2">(Bezug {fmtNum(p.k)} LP)</span></div>
      <div><span className="text-ink2">Siegchance: </span><strong className={chance >= 90 ? "text-moos" : chance >= 50 ? "text-messing" : "text-siegel"}>{chance} %</strong>
        {" "}<span className="text-ink2">· erwarteter Schaden {fmtNum(p.damageHp)} LP</span></div>
      <div><span className="text-ink2">Beute (bei der Heimkehr): </span><span className="text-moos">{resLine(p.loot)}</span></div>
      {p.treasure && <div><span className="text-ink2">Schatz des Leviathan, wenn er sinkt: </span><span className="text-moos">{resLine(p.treasure)}</span></div>}
      {p.flagship && chance < 50 && <div className="text-siegel">Allein kaum zu schaffen – öffne einen Sammelangriff.</div>}
    </div>
  );
}

/** Ruhmeshalle: Ergebnis des Finales einer Saison. */
export interface FinaleHallData {
  outcome: string;
  endedAtMs: number;
  totalHp: number;
  destroyedHp: number;
  champion: string | null;
  fleet: { name: string; tag: string } | null;
  top: { name: string; hp: number; share: number }[];
  own: { rank: number; hp: number; share: number } | null;
}

export function FinaleHall({ f }: { f: FinaleHallData }) {
  return (
    <div className="mt-2 pt-2 border-t border-navy-600 text-xs" data-testid="finale-hall">
      <div className="text-[11px] text-slate-400 mb-1">
        Saisonfinale: Leviathan {f.outcome === "sunk" ? `versenkt (${new Date(f.endedAtMs).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })})` : "entkommen"}
        {" "}· {fmtNum(f.destroyedHp)} LP vernichtet
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <dt className="text-slate-400">Bezwinger des Leviathan</dt><dd className="text-right truncate">{f.champion ?? "–"}</dd>
        <dt className="text-slate-400">Leviathan-Flotte</dt><dd className="text-right truncate">{f.fleet ? `[${f.fleet.tag}] ${f.fleet.name}` : "–"}</dd>
      </dl>
      {f.top.length > 1 && <div className="text-slate-400 mt-0.5">{f.top.map((p, i) => `${i + 1}. ${p.name} ${p.share} %`).join(" · ")}</div>}
      {f.own && <div className="mt-0.5"><span className="text-slate-400">Du: </span>Platz {f.own.rank} · {fmtNum(f.own.hp)} LP ({f.own.share} %)</div>}
    </div>
  );
}
