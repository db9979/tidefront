// Verwaltung → Statistik → Spielerbindung: Menschen und KI getrennt, Tages-Aktivität, Kohorten-Retention (Tag 1/7/14),
// Meilensteine mit Saisontag, Abschlussquoten von Tagesbefehlen und Wochenzielen, Laufzeit je tRPC-Aufruf.
// Mobil zuerst (390 px): schmale Tabellen in Mono, Zahlen rechtsbündig.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { Badge, Card, StatTable } from "../ui.tsx";
import { DayBars, RateBar } from "../components/Charts.tsx";

function Sub({ children }: { children: string }) {
  return <h3 className="font-serif text-base mt-3 mb-1.5 pb-0.5 border-b border-dotted border-rule">{children}</h3>;
}

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)} %`);
const share = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "–");
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

/** Schmale Tabelle: erste Spalte links, übrige rechts (Mono). */
function Grid({ head, rows, cols }: { head: string[]; rows: ReactNode[][]; cols: string }) {
  return (
    <div className="grid text-xs gap-x-2" style={{ gridTemplateColumns: cols }} role="table">
      {head.map((h, i) => (
        <div key={`h${i}`} role="columnheader" className={`font-display uppercase tracking-[0.08em] text-[11px] text-ink2 pb-1 border-b border-rule ${i ? "text-right" : ""}`}>{h}</div>
      ))}
      {rows.map((r, j) => r.map((c, i) => (
        <div key={`${j}-${i}`} role="cell" className={`py-1 border-b border-dotted border-rule ${i ? "text-right mono" : "min-w-0 truncate"}`}>{c}</div>
      )))}
    </div>
  );
}

export function AdminKpi({ days }: { days: 7 | 28 }) {
  const q = useQuery({ ...trpc.adminStats.kpi.queryOptions({ days }), refetchInterval: 120000, staleTime: 60000 });
  const k = q.data;
  if (!k) return <Card title="Spielerbindung"><p className="text-sm text-ink2 italic font-serif">{q.isError ? "Kennzahlen nicht verfügbar." : "Wird berechnet …"}</p></Card>;

  const h = k.players.humans;
  const b = k.players.bots;
  const t = k.retention.total;
  const d = k.completion.daily;
  const w = k.completion.weekly;
  const slotName = ["leicht", "mittel", "schwer"];
  const cohorts = k.retention.cohorts.filter((c) => c.size > 0);

  return (
    <>
      <Card title="Spielerbindung" right={k.season ? <Badge>Saisontag {k.season.day}</Badge> : undefined}>
        <Sub>Menschen und KI-Spieler</Sub>
        <Grid
          cols="1fr auto auto"
          head={["", "Menschen", "KI"]}
          rows={[
            ["gesamt (mit Hafen)", `${h.total} (${h.withBase})`, `${b.total} (${b.withBase})`],
            ["aktiv 24 h", String(h.active24h), String(b.active24h)],
            ["aktiv 7 Tage", String(h.active7d), String(b.active7d)],
          ]}
        />

        <Sub>Tages-Aktivität (Menschen)</Sub>
        <DayBars label="Aktive Menschen je Tag" days={k.activity.map((x) => x.d)} series={[{ key: "v", label: "aktiv", tone: "ink" }]} values={k.activity.map((x) => ({ v: x.v }))} height={90} />
        {k.activitySince && <p className="text-xs text-ink2">Erfasst seit {dm(k.activitySince)}; frühere Tage fehlen.</p>}

        <Sub>Retention nach Registrierung</Sub>
        <StatTable rows={[
          ["Tag 1", t.d1.of ? `${share(t.d1.back, t.d1.of)} (${t.d1.back}/${t.d1.of})` : "–"],
          ["Tag 7", t.d7.of ? `${share(t.d7.back, t.d7.of)} (${t.d7.back}/${t.d7.of})` : "–"],
          ["Tag 14", t.d14.of ? `${share(t.d14.back, t.d14.of)} (${t.d14.back}/${t.d14.of})` : "–"],
        ]} />
        {cohorts.length === 0 ? <p className="text-sm text-ink2 italic font-serif mt-2">Keine Registrierungen in den letzten 28 Tagen.</p> : (
          <div className="mt-2">
            <Grid
              cols="1fr 2.5rem 3rem 3rem 3rem"
              head={["Kohorte", "n", "T1", "T7", "T14"]}
              rows={cohorts.map((c) => [dm(c.day), String(c.size), pct(c.d1), pct(c.d7), pct(c.d14)])}
            />
          </div>
        )}
      </Card>

      <Card title="Meilensteine" right={<span className="text-xs text-ink2">Saisontag: erster · Median</span>}>
        {k.milestones.length === 0 ? <p className="text-sm text-ink2 italic font-serif">Noch keine Meilensteine in dieser Saison.</p> : (
          <Grid
            cols="1fr 2rem 4.25rem 2rem 4.25rem"
            head={["", "Mensch", "Tag", "KI", "Tag"]}
            rows={k.milestones.map((m) => [
              <span title={m.label}>{m.label}</span>,
              String(m.humans.count),
              m.humans.count ? `${m.humans.firstDay} · ${m.humans.medianDay}` : "–",
              String(m.bots.count),
              m.bots.count ? `${m.bots.firstDay} · ${m.bots.medianDay}` : "–",
            ])}
          />
        )}
        <p className="text-xs text-ink2 mt-2">KZ-Stufe, Missionsplätze und Startrampe erfasst der Worker alle 10 Minuten; Nester und zweiter Hafen aus den Berichten bzw. Häfen.</p>
      </Card>

      <Card title={`Abschlussquoten · ${days} Tage`} right={<span className="text-xs text-ink2">Menschen</span>}>
        <Sub>Tagesbefehle</Sub>
        <RateBar label="Erledigt" wins={d.completed} total={d.assigned} winLabel="erledigt" lossLabel="offen" tone="moos" />
        <RateBar label="Abgeholt" wins={d.claimed} total={d.assigned} winLabel="abgeholt" lossLabel="nicht abgeholt" tone="see" />
        <Grid
          cols="1fr 3.5rem 3.5rem 3.5rem"
          head={["Stufe", "vergeben", "erledigt", "abgeholt"]}
          rows={d.bySlot.map((s) => [slotName[s.slot] ?? String(s.slot), String(s.assigned), share(s.completed, s.assigned), share(s.claimed, s.assigned)])}
        />
        <p className="text-xs text-ink2 mt-1">Alle drei abgeholt: {d.fullDays} von {d.playerDays} Spieler-Tagen ({share(d.fullDays, d.playerDays)}).</p>

        <Sub>Wochenziele</Sub>
        <RateBar label="Erledigt" wins={w.completed} total={w.assigned} winLabel="erledigt" lossLabel="offen" tone="moos" />
        <RateBar label="Abgeholt" wins={w.claimed} total={w.assigned} winLabel="abgeholt" lossLabel="nicht abgeholt" tone="see" />
        <p className="text-xs text-ink2">{w.assigned} Ziele in {w.playerWeeks} Spieler-Wochen.</p>
      </Card>

      <Card title="Laufzeit je Aufruf" right={<span className="text-xs text-ink2">seit {new Date(k.rpc.since).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}>
        {k.rpc.rows.length === 0 ? <p className="text-sm text-ink2 italic font-serif">Noch keine Messungen.</p> : (
          <Grid
            cols="minmax(0,1fr) 2.75rem 3rem 3rem"
            head={["Prozedur", "n", "p50", "p95"]}
            rows={k.rpc.rows.slice(0, 40).map((r) => [
              <span className="mono text-[11px]" title={`${r.path} · max ${fmtNum(r.max, 1)} ms${r.errors ? ` · ${r.errors} Fehler` : ""}`}>{r.path}</span>,
              fmtNum(r.count),
              fmtNum(r.p50, 1),
              <span className={r.p95 >= 500 ? "text-siegel" : undefined}>{fmtNum(r.p95, 1)}</span>,
            ])}
          />
        )}
        <p className="text-xs text-ink2 mt-1">Millisekunden, letzte 256 Aufrufe je Prozedur, nur dieser API-Prozess (nach Neustart leer).</p>
      </Card>
    </>
  );
}
