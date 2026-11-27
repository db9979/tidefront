// Verwaltung → Statistik: Aktivität, Registrierungen, Ressourcenfluss, Kampf (Balance), Nester, Veteranen, Wirtschaft,
// Auffälligkeiten, Marktnachrichten. Der Server rechnet und speichert 60 s zwischen; Zeitraum 7 oder 28 Tage.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { Badge, Card, StatTable } from "../ui.tsx";
import { DayBars, HBars, LevelGrid, RateBar } from "../components/Charts.tsx";
import { AdminKpi } from "./AdminKpi.tsx";

type Days = 7 | 28;

function resRows(m: Record<string, number>) {
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([r, v]) => ({ key: r, value: v, label: <span className="inline-flex items-center gap-1"><Icon id={r} size={16} /> {label(r)}</span> }));
}

function Sub({ children }: { children: string }) {
  return <h3 className="font-serif text-base mt-3 mb-1.5 pb-0.5 border-b border-dotted border-rule">{children}</h3>;
}

export function AdminStats() {
  const [days, setDays] = useState<Days>(7);
  const q = useQuery({ ...trpc.adminStats.stats.queryOptions({ days }), refetchInterval: 120000, staleTime: 60000 });
  const s = q.data;

  const picker = (
    <div className="flex rounded-lg border border-rule overflow-hidden" role="group" aria-label="Zeitraum">
      {([7, 28] as Days[]).map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={days === d}
          onClick={() => setDays(d)}
          className={`tap px-3 text-xs font-display uppercase tracking-[0.1em] ${days === d ? "bg-ink text-paper" : "bg-card text-ink2"}`}
        >{d} Tage</button>
      ))}
    </div>
  );

  if (!s) return <Card title="Statistik" right={picker}><p className="text-sm text-ink2 italic font-serif">{q.isError ? "Statistik nicht verfügbar." : "Wird berechnet …"}</p></Card>;

  const dayKeys = s.registrations.perDay.map((d) => d.d);
  const one = (list: { d: string; v: number }[]) => list.map((x) => ({ v: x.v }));
  const c = s.combat;
  const lootTotal = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const a = s.anomalies;
  const anomalyCount = a.richPlayers.length + a.repeatedAttacks.length + (a.failedEvents.count > 0 ? 1 : 0);

  return (
    <>
      <Card title={`Statistik · ${days} Tage`} right={picker}>
        <p className="text-xs text-ink2 mb-2">
          {s.season ? `Saison ${s.season.number} seit ${new Date(s.season.startsAt).toLocaleDateString("de-DE")}` : "keine laufende Saison"} ·
          Stand {new Date(s.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} ({s.tz})
        </p>

        <Sub>Aktive Spieler</Sub>
        <StatTable rows={[
          ["Spieler gesamt (mit Hafen)", `${s.players.total} (${s.players.withBase})`],
          ["aktiv letzte 24 Std.", String(s.players.active24h)],
          ["aktiv letzte 7 Tage", String(s.players.active7d)],
          ["aktiv in dieser Saison", String(s.players.activeSeason)],
        ]} />

        <Sub>Registrierungen</Sub>
        <DayBars label="Registrierungen je Tag" days={dayKeys} series={[{ key: "v", label: "Registrierungen", tone: "ink" }]} values={one(s.registrations.perDay)} height={90} />
        <p className="text-xs text-ink2">{s.registrations.inRange} neu im Zeitraum, {s.registrations.total} insgesamt</p>
      </Card>

      <AdminKpi days={days} />

      <Card title="Ressourcenfluss">
        <Sub>Produktion je Stunde (alle Häfen, netto, mit Modifikatoren)</Sub>
        <HBars rows={resRows(s.flow.productionPerHour)} tone="moos" unit="/h" />

        <Sub>Beute im Zeitraum</Sub>
        <DayBars label="Beute je Tag (alle Ressourcen)" days={dayKeys} series={[{ key: "v", label: "Beute", tone: "messing", hatch: true }]} values={one(s.flow.loot.perDay)} height={90} />
        <StatTable rows={[
          ["von Spielern erbeutet", fmtNum(lootTotal(s.flow.loot.players))],
          ["vom Kartell erbeutet", fmtNum(lootTotal(s.flow.loot.kartell))],
        ]} />
        <div className="mt-2"><HBars rows={resRows(s.flow.loot.players)} tone="messing" /></div>

        <Sub>Börse</Sub>
        <DayBars label="Börsenumsatz je Tag in Krediten" days={dayKeys} series={[{ key: "v", label: "Umsatz", tone: "see" }]} values={one(s.flow.market.perDay)} height={90} />
        <StatTable rows={[
          ["Handel", fmtNum(s.flow.market.trades)],
          ["Umsatz (Kredite, ohne Gebühr)", fmtNum(s.flow.market.creditVolume)],
          ["Gebühren", fmtNum(s.flow.market.fees, 2)],
        ]} />
        <div className="mt-2"><HBars rows={resRows(s.flow.market.byResource)} tone="see" /></div>
      </Card>

      <Card title="Kampf">
        <DayBars
          label="Kämpfe je Tag"
          days={dayKeys}
          series={[
            { key: "pvp", label: "Spieler gegen Spieler", tone: "siegel" },
            { key: "nests", label: "Piratennester", tone: "ink", hatch: true },
            { key: "kartell", label: "Kartell-Überfälle", tone: "messing" },
          ]}
          values={c.perDay.map(({ pvp, nests, kartell }) => ({ pvp, nests, kartell }))}
        />
        <div className="mt-3">
          <RateBar label="Kartell gegen Spieler" wins={c.kartell.kartellWins} total={c.kartell.count} winLabel="Kartell siegt" lossLabel="Hafen hält" tone="siegel" />
          <RateBar label="Überfälle auf Spieler" wins={c.pvp.attackerWins} total={c.pvp.count} winLabel="Angreifer siegt" lossLabel="Verteidiger hält" tone="see" />
          <RateBar label="Überfälle auf Nester" wins={c.nests.attackerWins} total={c.nests.count} winLabel="Nest genommen" lossLabel="Nest hält" tone="moos" />
        </div>

        <Sub>Nester (höchste besiegte Stufe, Saison)</Sub>
        {s.nests.length === 0 ? <p className="text-sm text-ink2 italic font-serif">Noch kein Nest angegriffen.</p> : (
          <HBars rows={s.nests.map((n) => ({ key: String(n.playerId), label: n.name, value: n.maxLevel ?? 0, note: `${n.wins}/${n.attempts}` }))} tone="ink" />
        )}
      </Card>

      <Card title="Veteranen" right={<span className="text-xs text-ink2">alle Häfen</span>}>
        <Sub>Einheiten je Rang (daheim und unterwegs)</Sub>
        <HBars rows={s.veterans.ranks.map((r) => ({ key: r.id, label: r.name, value: r.units, note: `${r.bases} ${r.bases === 1 ? "Hafen" : "Häfen"}${r.attackBonus ? ` · +${fmtNum(r.attackBonus * 100)} %` : ""}` }))} tone="messing" />
        <Sub>Je Einheitentyp (Ø Erfahrung)</Sub>
        {s.veterans.byUnit.length === 0 ? <p className="text-sm text-ink2 italic font-serif">Keine Einheiten.</p> : (
          <ul className="text-sm space-y-1">
            {s.veterans.byUnit.map((u) => (
              <li key={u.id}>
                <div className="flex justify-between gap-2">
                  <span className="inline-flex items-center gap-1 min-w-0"><Icon id={u.id} size={16} /> <span className="truncate">{label(u.id)}</span></span>
                  <span className="mono shrink-0">{fmtNum(u.units)} · Ø {fmtNum(u.avgXp, 1)} EP</span>
                </div>
                <div className="text-xs text-ink2 pl-6">
                  {s.veterans.ranks.filter((r) => u.ranks[r.id]).map((r) => `${r.name} ${fmtNum(u.ranks[r.id])}`).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Wirtschaft" right={<span className="text-xs text-ink2">{s.economy.bases} Häfen</span>}>
        <StatTable rows={[["Ø Stufe Kommandozentrale", fmtNum(s.economy.avgKommandozentrale, 1)]]} />
        <Sub>Gebäudestufen (Anzahl Häfen je Stufe)</Sub>
        <LevelGrid rows={s.economy.buildings.map((b) => ({ ...b, label: label(b.id) }))} />
      </Card>

      {s.marketNews && (
        <Card title="Marktnachrichten (jetzt)">
          <ul className="text-sm space-y-1">
            {s.marketNews.map((r) => (
              <li key={r.id}>
                <div className="flex justify-between gap-2">
                  <span className="inline-flex items-center gap-1"><Icon id={r.id} size={16} /> {label(r.id)}</span>
                  <span className="mono">{fmtNum(r.offset * 100, 1)} %</span>
                </div>
                <div className="mono text-ink2 text-xs pl-6">Ziel {fmtNum(r.target * 100, 1)} % · Richtwert {fmtNum(r.effective, 3)}</div>
                {r.influences.map((x, i) => (
                  <div key={i} className="text-xs text-ink2 pl-6">{x.reason}: {fmtNum(x.now * 100, 1)} %</div>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Auffälligkeiten" right={anomalyCount ? <Badge tone="red">{anomalyCount}</Badge> : <Badge tone="green">keine</Badge>}>
        <Sub>Ressourcen weit über dem Median</Sub>
        {a.richPlayers.length === 0 ? <p className="text-sm text-ink2">keine</p> : (
          <ul className="text-sm space-y-1">
            {a.richPlayers.map((r) => (
              <li key={r.playerId} className="flex justify-between gap-2"><span className="font-bold">{r.name}</span><span className="mono">{fmtNum(r.total)} <span className="text-ink2 text-xs">({fmtNum(r.ratio, 1)} × Median)</span></span></li>
            ))}
          </ul>
        )}
        <Sub>Häufige Angriffe auf dasselbe Ziel (ab 5 an einem Tag)</Sub>
        {a.repeatedAttacks.length === 0 ? <p className="text-sm text-ink2">keine</p> : (
          <ul className="text-sm space-y-1">
            {a.repeatedAttacks.map((r) => (
              <li key={`${r.attacker}-${r.defender}`} className="flex justify-between gap-2">
                <span><strong>{r.attacker}</strong> → {r.defender}</span>
                <span className="mono">{r.maxPerDay}/Tag <span className="text-ink2 text-xs">({r.total} im Zeitraum)</span></span>
              </li>
            ))}
          </ul>
        )}
        <Sub>Fehlgeschlagene Ereignisse</Sub>
        {a.failedEvents.count === 0 ? <p className="text-sm text-ink2">keine</p> : (
          <ul className="text-xs space-y-1">
            <li className="text-sm">{a.failedEvents.count} insgesamt, zuletzt:</li>
            {a.failedEvents.recent.map((f) => (
              <li key={f.id} className="break-words"><span className="mono">#{f.id} {f.type}</span> · {new Date(f.at).toLocaleString("de-DE")} · <span className="text-siegel">{f.error ?? "–"}</span></li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
