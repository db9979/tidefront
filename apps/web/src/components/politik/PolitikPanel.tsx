// Weltpolitik auf Basis → Lage (docs/REGELN-WELTPOLITIK.md): laufende und angekündigte Gezeit bzw. Beschlüsse mit
// Restzeit, offene Seerat-Sitzungen (drei Knöpfe, eigene Stimme geheim und änderbar), das letzte Ergebnis mit
// Auszählung, Paktangebote der KI-Spieler (Annehmen mit einem Tippen) und der Saisonkalender zum Aufklappen.
import { useState } from "react";
import { trpcClient } from "../../lib/trpc.ts";
import { useCommand } from "../../lib/command.ts";
import { fmtDuration, fmtRange, fmtTime, useCountdownNow } from "../../lib/time.ts";
import { Icon } from "../../icons.tsx";
import { Badge, Button, ErrorLine } from "../../ui.tsx";
import { politikInvalidate, usePolitik, type PolitikOverview } from "./use-politik.ts";

type Win = PolitikOverview["windows"][number];
type Session = PolitikOverview["seerat"][number];
type Res = { ok: boolean; code?: string };

const DAY = 86_400_000;
const RESULT_SHOW_MS = 2 * DAY;

const windowLabel = (w: Win) => (w.slot === "gezeit" && w.source === "plan" ? "Gezeit" : w.source === "admin" ? "Abgesagt" : "Seerat-Beschluss");

/** full (Meldungen → Saison → Welt, UX 0.43): Kalender als Zeitleiste offen, Überschrift ohne Kartenrahmen-Wiederholung. */
export function PolitikPanel({ full = false }: { full?: boolean } = {}) {
  const q = usePolitik();
  const d = q.data;
  const now = useCountdownNow(d?.nextChangeMs, ...(d?.seerat.map((s) => s.closesMs) ?? []));
  if (!d || !d.enabled) return full && d ? <p className="panel rounded-xl p-3.5 text-sm text-ink2" data-testid="politik-off">Weltpolitik ist in dieser Saison nicht aktiv.</p> : null;
  const shown = d.windows.filter((w) => w.effect !== "ruhig" && w.endMs > now && (w.active || w.announced));
  const open = d.seerat.filter((s) => s.status === "offen");
  const results = d.seerat.filter((s) => s.status === "geschlossen" && s.tally && now - s.closesMs < RESULT_SHOW_MS);
  return (
    <section className="panel rounded-xl p-3.5 mb-3" aria-label="Weltpolitik" data-testid="politik-panel" id="politik-panel">
      <h2 className="font-display text-[11px] uppercase text-ink2 tracking-[0.16em] flex items-center gap-2 mb-1">
        <Icon id="wind" size={16} /> Weltpolitik
      </h2>
      {d.pakte.map((p) => <PaktOffer key={p.id} offer={p} />)}
      {shown.length === 0 && open.length === 0 && d.pakte.length === 0 && (
        <p className="text-sm text-ink2 py-1">Ruhige See – keine Gezeit und kein Beschluss in Kraft.{d.nextChangeMs ? ` Nächster Wechsel ${fmtTime(d.nextChangeMs, now)}.` : ""}</p>
      )}
      <ul>
        {shown.map((w) => (
          <li key={w.id} className="dotted-row py-2 flex gap-2.5 items-start" data-testid="politik-window">
            <Icon id="wind" size={24} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold">{windowLabel(w)}: {w.name}</span>
              <span className="block text-xs text-ink2">{w.satz}</span>
              {w.active && d.lines.length > 0 && <span className="block text-xs mt-0.5">{d.lines.map((l) => l.text).join(" · ")}</span>}
            </span>
            <span className="text-right leading-tight shrink-0">
              <span className="block mono text-[13px]">{w.active ? `noch ${fmtDuration(w.endMs - now)}` : `in ${fmtDuration(w.startMs - now)}`}</span>
              <span className="block mono text-[11px] text-ink2">{w.active ? `bis ${fmtTime(w.endMs, now)}` : fmtTime(w.startMs, now)}</span>
            </span>
          </li>
        ))}
      </ul>
      {open.map((s) => <SessionVote key={s.id} s={s} now={now} />)}
      {results.map((s) => <SessionResult key={s.id} s={s} now={now} />)}
      <Calendar windows={d.windows} now={now} initialOpen={full} />
    </section>
  );
}

function SessionVote({ s, now }: { s: Session; now: number }) {
  const vote = useCommand((i: { key: string; sitzungId: number; option: string }) => trpcClient.politik.vote.mutate(i) as Promise<Res>, politikInvalidate);
  return (
    <div className="mt-2 rounded-lg border border-rule p-2.5" role="group" aria-label="Seerat-Abstimmung" data-testid="seerat-vote">
      <div className="flex items-baseline gap-2 flex-wrap">
        <strong className="font-serif text-[16px]">Der Seerat tagt</strong>
        <span className="text-xs text-ink2">{s.kind === "fenster" ? "über das nächste Gezeit-Fenster" : "Wochensitzung"}</span>
        <span className="ml-auto mono text-[13px]" title="Abstimmung endet">noch {fmtDuration(s.closesMs - now)}</span>
      </div>
      {s.effectStartMs !== null && s.effectEndMs !== null && (
        <p className="text-xs text-ink2">Wirkt {fmtRange(s.effectStartMs, s.effectEndMs, now)} · Stimmen bisher: <span className="mono">{s.votes ?? 0}</span> (geheim)</p>
      )}
      <div className="grid gap-1.5 mt-2 sm:grid-cols-3">
        {s.options.map((o) => {
          const mine = s.myVote === o.key;
          return (
            <button key={o.key} type="button" aria-pressed={mine} disabled={vote.busy}
              onClick={() => void vote.run({ sitzungId: s.id, option: o.key })}
              className={`tap rounded-lg border px-2.5 py-2 text-left min-w-0 ${mine ? "bg-ink text-paper border-ink" : "border-ink/50 bg-card"}`}>
              <span className="block text-sm font-semibold break-words">{o.name}{mine ? " ✓" : ""}</span>
              {o.satz && <span className={`block text-[11px] ${mine ? "text-paper/80" : "text-ink2"}`}>{o.satz}</span>}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-ink2 mt-1">{s.myVote ? "Deine Stimme zählt; bis zum Schluss änderbar." : "Jeder Kapitän hat eine Stimme, alle KI-Spieler zusammen eine; eine Allianz zählt höchstens 40 %."}</p>
      <ErrorLine text={vote.error} code={vote.code} />
    </div>
  );
}

type Tally = { winner: string; weights: Record<string, number>; humanVotes: Record<string, number>; kiVotes: { name: string; profile: string; option: string; weight: number }[]; quorum: number; voted: number; quorumMet: boolean };
const PROFILE: Record<string, string> = { haendler: "Händler", festung: "Festung", freibeuter: "Freibeuter" };

function SessionResult({ s, now }: { s: Session; now: number }) {
  const t = s.tally as Tally;
  const name = (k: string) => s.options.find((o) => o.key === k)?.name ?? k;
  const total = Object.values(t.weights).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="mt-2 rounded-lg border border-rule p-2.5" data-testid="seerat-result" aria-label="Seerat-Ergebnis">
      <div className="flex items-baseline gap-2 flex-wrap">
        <strong className="font-serif text-[16px]">Seerat: {name(s.result ?? t.winner)}</strong>
        {s.effectStartMs !== null && s.effectEndMs !== null && <span className="text-xs text-ink2">{fmtRange(s.effectStartMs, s.effectEndMs, now)}</span>}
      </div>
      <p className="text-xs text-ink2">{t.quorumMet ? `${t.voted} Stimmen (mindestens ${t.quorum} nötig).` : `Zu wenige Stimmen (${t.voted} von ${t.quorum}) – es gilt die Vorgabe.`}</p>
      <ul className="mt-1 space-y-1">
        {s.options.map((o) => {
          const w = t.weights[o.key] ?? 0;
          return (
            <li key={o.key} className="text-xs">
              <div className="flex justify-between gap-2"><span className={o.key === (s.result ?? t.winner) ? "font-semibold" : ""}>{o.name}</span>
                <span className="mono">{t.humanVotes[o.key] ?? 0} Stimmen · Gewicht {String(w).replace(".", ",")}</span></div>
              <div className="h-1.5 bg-inset border border-rule"><div className="h-full bg-see" style={{ width: `${(w / total) * 100}%` }} /></div>
            </li>
          );
        })}
      </ul>
      {t.kiVotes.length > 0 && (
        <p className="text-[11px] text-ink2 mt-1">KI-Spieler (zusammen eine Stimme): {t.kiVotes.map((k) => `${k.name} (${PROFILE[k.profile] ?? k.profile}) für ${name(k.option)}`).join("; ")}.</p>
      )}
    </div>
  );
}

function PaktOffer({ offer }: { offer: PolitikOverview["pakte"][number] }) {
  const accept = useCommand((i: { key: string; id: number }) => trpcClient.politik.acceptPakt.mutate({ id: i.id }) as Promise<Res>, politikInvalidate);
  const decline = useCommand((i: { key: string; id: number }) => trpcClient.politik.declinePakt.mutate({ id: i.id }) as Promise<Res>, politikInvalidate);
  return (
    <div className="mb-2 rounded-lg border border-moos p-2.5" data-testid="pakt-offer" role="group" aria-label={`Paktangebot ${offer.kiName}`}>
      <p className="text-sm"><strong>{offer.kiName}</strong> ({offer.profileText}) bietet dir einen <strong>Nichtangriffspakt</strong> an – dein Ansehen bei ihm ist „Vertraut“. Gegenseitige Überfälle sind dann ausgeschlossen; Kündigung mit 24 h Frist.</p>
      <div className="flex flex-wrap gap-2 mt-2 justify-end">
        <Button kind="ghost" className="whitespace-nowrap px-3" disabled={decline.busy || accept.busy} onClick={() => void decline.run({ id: offer.id })}>Ablehnen</Button>
        <Button className="whitespace-nowrap px-3" disabled={decline.busy || accept.busy} onClick={() => void accept.run({ id: offer.id })}>Annehmen</Button>
      </div>
      <ErrorLine text={accept.error ?? decline.error} code={accept.code ?? decline.code} />
    </div>
  );
}

function Calendar({ windows, now, initialOpen = false }: { windows: Win[]; now: number; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const firstFuture = windows.findIndex((w) => w.endMs > now);
  if (windows.length === 0) return null;
  return (
    <div className="mt-2">
      <button type="button" className="tap text-xs text-ink2 underline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Kalender schließen" : "Kalender der Saison"}
      </button>
      {open && (
        <ul className="mt-1 text-xs" data-testid="politik-calendar">
          {windows.map((w, i) => (
            <li key={w.id} className={`dotted-row py-1 flex flex-wrap gap-2 ${w.endMs <= now ? "text-ink2" : ""}`}>
              {/* Zeitleiste: Marke „jetzt“ vor dem ersten noch offenen Fenster. */}
              {i === firstFuture && i > 0 && <span className="w-full -mt-1 mb-0.5 border-t-2 border-siegel text-[10px] uppercase tracking-[0.14em] text-siegel" data-testid="politik-now">jetzt</span>}
              <span className="mono shrink-0">{fmtRange(w.startMs, w.endMs, now)}</span>
              <span className="flex-1 min-w-0">{windowLabel(w)}: {w.announced || w.slot === "woche" ? w.name : "angekündigt 24 h vorher"}</span>
              {w.active && <Badge tone="green">jetzt</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
