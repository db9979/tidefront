// Verwaltung → Statistik, Balance live (Welle 2): Rohstoffbilanz (Bestand, Füllgrad, Stunden Produktion je Rohstoff aus
// dem Tagesschnappschuss), Zuflüsse (Produktion, Belohnungen, Beute, Kartell, Börse), Welt & Worker (Weltereignisse,
// Marktnachrichten, Schrittdauer des Workers) und Nutzung je System. Mobil zuerst (390 px), Zahlen in Mono.
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { Card } from "../ui.tsx";
import { DayBars } from "../components/Charts.tsx";
import { Grid, Sub } from "./AdminKpi.tsx";

type ResMap = Record<string, number>;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const SOURCES = [
  { key: "production", label: "Produktion" },
  { key: "rewards", label: "Belohnungen" },
  { key: "loot", label: "Beute" },
  { key: "market", label: "Börse netto" },
  { key: "kartell", label: "an Kartell" },
] as const;
const SYSTEM_NAMES: Record<string, string> = {
  gesamt: "alle Befehle", bau: "Ausbau", ausbildung: "Ausbildung", forschung: "Forschung", boerse: "Börse", spielerhandel: "Spielerhandel",
  vertraege: "Lieferverträge", felder: "Felder", admirale: "Admirale", "allianz-ops": "Allianz-Ops", lagebild: "Lagebild",
  strom: "Seekabel", befehle: "Tagesbefehle", auftragsbuch: "Auftragsbuch", missionen: "Missionen", hafen: "Hafen", sonstiges: "Sonstiges",
};
const EVENT_NAMES: Record<string, string> = { schatzschiff: "Schatzschiff", grossflotte: "Großflotte", belagerung: "Belagerung", finale: "Finale" };

function ResName({ r }: { r: string }) {
  return <span className="inline-flex items-center gap-1"><Icon id={r} size={14} /> {label(r)}</span>;
}

export function AdminBalance({ days }: { days: 7 | 28 }) {
  const q = useQuery({ ...trpc.adminStats.balance.queryOptions({ days }), refetchInterval: 120000, staleTime: 60000 });
  const b = q.data;
  if (!b) return <Card title="Rohstoffbilanz"><p className="text-sm text-ink2 italic font-serif">{q.isError ? "Kennzahlen nicht verfügbar." : "Wird berechnet …"}</p></Card>;

  const value = (m: ResMap) => Object.entries(m).reduce((a, [r, v]) => a + v * (b.refPrice[r] ?? 1), 0);
  const dayKeys = b.inflow.perDay.map((x) => x.d);
  const prodTotal = value(b.inflow.total.production);
  const share = (v: number) => (prodTotal > 0 ? pct(v / prodTotal) : "–");

  return (
    <>
      <Card title="Rohstoffbilanz" right={<span className="text-xs text-ink2">{b.stock.day ? `Stand ${dm(b.stock.day)} (Tagesbeginn)` : "noch kein Schnappschuss"}</span>}>
        {(["humans", "bots"] as const).map((g) => {
          const grp = b.stock[g];
          return (
            <div key={g}>
              <Sub>{`${g === "humans" ? "Menschen" : "KI-Spieler"} (${grp.players})`}</Sub>
              {grp.players === 0 ? <p className="text-sm text-ink2 italic font-serif">Keine Häfen im Schnappschuss.</p> : (
                <Grid
                  cols="1fr 4rem 3rem 3rem 3rem"
                  head={["", "Median", "Füllgr.", "max", "h Prod."]}
                  rows={b.resources.map((r) => {
                    const c = grp.byResource[r];
                    return [<ResName r={r} />, fmtNum(c.median), pct(c.fillMedian), pct(c.fillMax), fmtNum(c.hoursMedian, c.hoursMedian < 10 ? 1 : 0)];
                  })}
                />
              )}
            </div>
          );
        })}
        <Sub>Füllgrad im Median je Tag (alle Spieler)</Sub>
        <Grid
          cols={`3.5rem ${b.resources.map(() => "1fr").join(" ")}`}
          head={["Tag", ...b.resources.map((r) => label(r).slice(0, 5))]}
          rows={b.stock.perDay.filter((x) => Object.values(x.fill).some((v) => v > 0)).slice(-10).map((x) => [dm(x.d), ...b.resources.map((r) => pct(x.fill[r] ?? 0))])}
        />
        <p className="text-xs text-ink2 mt-1">Häfen je Spieler summiert. „h Prod.“: Bestand in Stunden der eigenen Netto-Produktion (Median). Der Worker schreibt den Schnappschuss einmal je Kalendertag.</p>
      </Card>

      <Card title={`Zuflüsse · ${days} Tage`} right={<span className="text-xs text-ink2">Richtwert, alle Spieler</span>}>
        <Grid
          cols="1fr 4.5rem 3rem"
          head={["Quelle", "Richtwert", "% Prod."]}
          rows={SOURCES.map((s) => {
            const v = value(b.inflow.total[s.key]);
            return [s.label, fmtNum(Math.round(v)), s.key === "production" ? "100 %" : share(v)];
          })}
        />
        <Sub>Je Rohstoff</Sub>
        <Grid
          cols={`1fr ${SOURCES.map(() => "3.6rem").join(" ")}`}
          head={["", ...SOURCES.map((s) => s.label.slice(0, 6))]}
          rows={b.resources.map((r) => [<ResName r={r} />, ...SOURCES.map((s) => fmtNum(Math.round(b.inflow.total[s.key][r] ?? 0)))])}
        />
        <Sub>Belohnungen und Beute je Tag</Sub>
        <DayBars
          label="Belohnungen und Beute je Tag (Richtwert)"
          days={dayKeys}
          series={[{ key: "rewards", label: "Belohnungen", tone: "moos" }, { key: "loot", label: "Beute", tone: "messing", hatch: true }]}
          values={b.inflow.perDay.map((x) => ({ rewards: value(x.rewards), loot: value(x.loot) }))}
          height={90}
        />
        <p className="text-xs text-ink2 mt-1">Produktion aus dem Tagesschnappschuss (Netto je Stunde × 24). Belohnungen: abgeholte Tagesbefehle und Wochenziele. „an Kartell“: Beute des Kartells (Überfälle, Weltereignisse). Börse netto: gekauft minus verkauft.</p>
      </Card>

      <Card title="Welt & Worker" right={<span className="text-xs text-ink2">{fmtNum(b.world.newsRows)} Marktnachrichten</span>}>
        <Sub>Weltereignisse je Tag</Sub>
        <DayBars
          label="Weltereignisse je Tag"
          days={dayKeys}
          series={[
            { key: "schatzschiff", label: EVENT_NAMES.schatzschiff, tone: "messing" },
            { key: "grossflotte", label: EVENT_NAMES.grossflotte, tone: "siegel" },
            { key: "belagerung", label: EVENT_NAMES.belagerung, tone: "see" },
            { key: "finale", label: EVENT_NAMES.finale, tone: "ink" },
          ]}
          values={b.world.events.map((e) => ({ schatzschiff: e.schatzschiff, grossflotte: e.grossflotte, belagerung: e.belagerung, finale: e.finale }))}
          height={80}
        />
        <Sub>Neue Marktnachrichten je Tag</Sub>
        <DayBars label="Marktnachrichten je Tag" days={dayKeys} series={[{ key: "v", label: "Zeilen", tone: "ink" }]} values={b.world.news.map((x) => ({ v: x.v }))} height={70} />
        <Sub>Schrittdauer des Workers</Sub>
        {b.world.steps.length === 0 ? <p className="text-sm text-ink2 italic font-serif">Noch keine Messungen.</p> : (
          <Grid
            cols="minmax(0,1fr) 3rem 3rem 3.5rem 2.25rem"
            head={["Schritt", "n", "Ø ms", "max", "≥ 2 s"]}
            rows={b.world.steps.slice(0, 30).map((s) => [
              <span className="mono text-[11px]" title={`Summe ${fmtNum(s.totalMs)} ms${s.errors ? ` · ${s.errors} Fehler` : ""}`}>{s.step}</span>,
              fmtNum(s.runs),
              fmtNum(s.avgMs, 1),
              <span className={s.maxMs >= 2000 ? "text-siegel" : undefined}>{fmtNum(s.maxMs, 0)}</span>,
              <span className={s.slow > 0 || s.errors > 0 ? "text-siegel" : undefined}>{s.errors ? `${s.slow}/${s.errors}F` : String(s.slow)}</span>,
            ])}
          />
        )}
        <p className="text-xs text-ink2 mt-1">Millisekunden je Lauf, alle Tage im Zeitraum (Tabelle worker_step_day). Langsam: ab 2 s (zusätzlich im Worker-Log „slow step“).</p>
      </Card>

      <Card title="Nutzung je System" right={<span className="text-xs text-ink2">{b.usage.days} Tage verdichtet</span>}>
        {b.usage.rows.length === 0 ? <p className="text-sm text-ink2 italic font-serif">Noch keine abgeschlossenen Tage verdichtet.</p> : (
          <Grid
            cols="1fr 3rem 3.5rem 2.5rem 3.5rem"
            head={["System", "Mensch", "Befehle", "KI", "Befehle"]}
            rows={b.usage.rows.map((u) => [SYSTEM_NAMES[u.system] ?? u.system, String(u.humans), fmtNum(u.humanUses), String(u.bots), fmtNum(u.botUses)])}
          />
        )}
        <p className="text-xs text-ink2 mt-1">Erfolgreiche Befehle je System; Spieler = höchste Zahl verschiedener Spieler an einem Tag. Der Worker verdichtet jeden abgeschlossenen Tag aus dem Befehlsprotokoll.</p>
      </Card>
    </>
  );
}
