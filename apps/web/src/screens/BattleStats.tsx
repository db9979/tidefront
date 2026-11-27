// Meldungen → Rangliste → Bilanz: persönliche Kampfbilanz der Saison (Server: report.stats, kurz zwischengespeichert).
import { useQuery } from "@tanstack/react-query";
import { trpc, type Outputs } from "../lib/trpc.ts";
import { fmtNum, label, nOf } from "../lib/names.ts";
import { Card, Loading, StatTable, UnitChips } from "../ui.tsx";
import { Icon, IconTile } from "../icons.tsx";
import { D20 } from "../components/BattleDice.tsx";
import { RankBadge } from "../components/Breakdown.tsx";

type Stats = Outputs["report"]["stats"];

const CATEGORY: { id: keyof Stats["record"]; name: string }[] = [
  { id: "ueberfall", name: "Überfälle auf Häfen" },
  { id: "abwehr", name: "Abwehr gegen Spieler" },
  { id: "nest", name: "Piratennester" },
  { id: "kartell", name: "Kartell-Abwehr" },
  { id: "weltereignis", name: "Weltereignisse" },
  { id: "spionage", name: "Spionage (enttarnte Spione)" },
];

/** Sieg-/Niederlagen-Balken einer Kategorie (Siege Moos, Niederlagen Siegelrot). */
function RecordBar({ wins, losses }: { wins: number; losses: number }) {
  const n = wins + losses;
  return (
    <svg width="100%" height="8" className="block" aria-hidden="true">
      <rect x="0" y="0" width="100%" height="8" rx="2" fill="var(--color-inset)" stroke="var(--color-rule)" />
      {n > 0 && <rect x="0" y="0" width={`${(wins / n) * 100}%`} height="8" rx="2" fill="var(--color-moos)" />}
      {n > 0 && losses > 0 && <rect x={`${(wins / n) * 100}%`} y="0" width={`${(losses / n) * 100}%`} height="8" rx="2" fill="var(--color-siegel)" opacity="0.85" />}
    </svg>
  );
}

function LuckMeter({ avg, expected }: { avg: number; expected: number }) {
  // Skala 1 … 20, Erwartung als Strich, eigener Schnitt als Raute.
  const x = (v: number) => 4 + ((v - 1) / 19) * 192;
  return (
    <svg viewBox="0 0 200 22" width="100%" height="22" aria-label={`Durchschnitt ${fmtNum(avg, 1)} gegenüber ${String(expected).replace(".", ",")}`}>
      <line x1="4" y1="11" x2="196" y2="11" stroke="var(--color-ink2)" strokeWidth="1" />
      {[1, 5, 10, 15, 20].map((t) => <line key={t} x1={x(t)} y1="7" x2={x(t)} y2="15" stroke="var(--color-rule)" />)}
      <line x1={x(expected)} y1="3" x2={x(expected)} y2="19" stroke="var(--color-ink)" strokeDasharray="2 2" />
      <path d={`M${x(avg)} 4 L${x(avg) + 5} 11 L${x(avg)} 18 L${x(avg) - 5} 11 Z`} fill={avg >= expected ? "var(--color-moos)" : "var(--color-siegel)"} />
    </svg>
  );
}

export function BattleStatsScreen() {
  const q = useQuery(trpc.report.stats.queryOptions());
  if (!q.data) return <Loading />;
  const s = q.data;
  if (s.battles === 0) {
    return <Card title="Kampfbilanz"><p className="text-sm text-ink2">In dieser Saison noch kein Kampf. Überfälle, Nester, Kartell-Angriffe und Weltereignisse erscheinen hier.</p></Card>;
  }
  const luck = s.luck;
  const diff = luck.average === null ? 0 : luck.average - luck.expected;
  return (
    <div>
      <Card title="Kampfbilanz der Saison" right={<span className="mono text-sm"><span className="text-moos">{s.wins} S</span> · <span className="text-siegel">{s.losses} N</span></span>}>
        <ul className="space-y-2">
          {CATEGORY.filter((c) => s.record[c.id].wins + s.record[c.id].losses > 0).map((c) => (
            <li key={c.id}>
              <div className="flex justify-between text-sm mb-0.5">
                <span>{c.name}</span>
                <span className="mono"><span className="text-moos">{s.record[c.id].wins}</span> : <span className="text-siegel">{s.record[c.id].losses}</span></span>
              </div>
              <RecordBar wins={s.record[c.id].wins} losses={s.record[c.id].losses} />
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Versenkt und vernichtet">
        <StatTable rows={[
          ["Versenkte Tonnage", `${fmtNum(s.sunkValue)} (${nOf(s.sunkShips, "Schiff", "Schiffe")})`],
          ["Vernichteter Gesamtwert", fmtNum(s.destroyedValue)],
          ["Eigene Verluste (Wert)", fmtNum(s.ownLossValue)],
          ["Stärkstes besiegtes Nest", s.strongestNest === null ? "–" : `Stufe ${s.strongestNest}`],
        ]} />
        <p className="text-xs text-ink2 mt-2">Wert = Kosten der Einheiten (wie in der Wertung). Lazarett, Reparatur und beschädigte Flugzeuge zählen nicht als Verlust.</p>
        {Object.keys(s.ownLosses).length > 0 && <p className="text-sm mt-2"><span className="text-ink2">Eigene Verluste: </span><UnitChips counts={s.ownLosses} /></p>}
      </Card>

      {s.bestUnit && (
        <Card title="Beste Einheit">
          <div className="flex items-center gap-3">
            <IconTile id={s.bestUnit.id} size={52} />
            <div>
              <div className="font-serif text-[18px]">{label(s.bestUnit.id)}</div>
              <div className="text-sm text-ink2">{fmtNum(s.bestUnit.damage)} Schaden ausgeteilt</div>
            </div>
          </div>
        </Card>
      )}

      <Card title={<span className="flex items-center gap-2"><D20 roll={20} size={20} />Würfelglück</span>}>
        {luck.average === null ? <p className="text-sm text-ink2">Noch keine Würfe (Berichte vor dem Kriegsglück zählen nicht).</p> : (
          <>
            <p className="text-sm">
              Schnitt <strong className="mono">{fmtNum(luck.average, 2)}</strong> aus {fmtNum(luck.rolls)} Würfen – erwartet {String(luck.expected).replace(".", ",")}.{" "}
              <span className={diff >= 0 ? "text-moos" : "text-siegel"}>{Math.abs(diff) < 0.25 ? "Ganz durchschnittlich." : diff > 0 ? "Das Glück ist mit dir." : "Pech gehabt."}</span>
            </p>
            <LuckMeter avg={luck.average} expected={luck.expected} />
            <p className="text-xs text-ink2">Pannen (1): {luck.pannen} · Volltreffer (20): {luck.volltreffer}</p>
          </>
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><Icon id="kampfpanzer" size={20} />Veteranen</span>}>
        {s.veterans.length === 0 ? <p className="text-sm text-ink2">Noch keine Einheiten.</p> : (
          <ul className="divide-y divide-navy-700">
            {s.veterans.map((v) => (
              <li key={v.id} className="flex items-center gap-2 py-1.5 text-sm">
                <Icon id={v.id} size={24} />
                <span className="flex-1 min-w-0 truncate">{label(v.id)}</span>
                <span className="mono text-ink2 text-xs">{String(v.xp).replace(".", ",")} EP</span>
                <RankBadge vet={v} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
