// Auftragsbuch: eine Kette von Aufträgen, die durch die ersten Spieltage führt. Erfüllung, Belohnung und
// Abholstatus kommen vom Server (guide.get); hier stehen nur Texte, Symbole und Wege zum Ziel.
// Einstieg (0.22): 30 Schützen statt 20 (sonst ist Nest Stufe 1 kaum zu schlagen), „Los“ führt zum Ausbilden bzw. zu
// den lohnenden Zielen, frische Daten bei jedem Bau-/Ausbildungsende, Warnung vor Belohnungen über der Lagergrenze.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient, type BaseData, type Balance, type Outputs } from "../lib/trpc.ts";
import { serverNow } from "../lib/time.ts";
import { useCommand } from "../lib/command.ts";
import { countLabel, fmtNum } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { Badge, Bar, Button, ErrorLine, ResChips } from "../ui.tsx";

/** seg: Unterreiter, der beim Öffnen des Reiters gewählt sein soll (z. B. Truppen → Ausbilden). */
export type GuideAction = { kind: "building"; id: string } | { kind: "tab"; tab: "karte" | "truppen" | "boerse" | "berichte"; seg?: string };

/** Unterreiter vormerken (useSegment liest ihn beim Aufbau), dann wie gewohnt navigieren. */
export function runGuideAction(a: GuideAction, onAction: (a: GuideAction) => void): void {
  if (a.kind === "tab" && a.seg) localStorage.setItem(`tf-seg:${a.tab}`, a.seg);
  onAction(a);
}

/** Ausbildungsziele (wie GUIDE_GOALS im Server, packages/engine/src/guide.ts). */
export const GOALS = { schuetzen: 30, korvette: 2, landungsschiff: 1 } as const;
type GuideData = Outputs["guide"]["get"];

interface Step {
  id: string;
  icon: string;
  title: string;
  /** Begründung; Zahlen aus der Balance, sobald sie geladen ist. */
  why: string | ((bal: Balance | undefined) => string);
  action: GuideAction;
  actionText: string;
}

const lvl = (b: BaseData, id: string) => b.buildings.find((x) => x.id === id)?.level ?? 0;

export const STEPS: Step[] = [
  { id: "strom", icon: "kraftwerk", title: "Kraftwerk bauen", why: "Zuerst Strom: Stahlwerk, Raffinerie, Chipfabrik und Versorgungshof brauchen ihn. Ohne Kraftwerk liefern sie nichts – es läuft nur die kleine Grundproduktion.", action: { kind: "building", id: "kraftwerk" }, actionText: "Zum Kraftwerk" },
  { id: "stahl", icon: "stahlwerk", title: "Stahlwerk bauen", why: "Stahl ist der wichtigste Rohstoff. Fast jeder Ausbau und jedes Schiff braucht ihn. Mit dem Kraftwerk läuft es sofort mit voller Leistung.", action: { kind: "building", id: "stahlwerk" }, actionText: "Zum Stahlwerk" },
  { id: "basis", icon: "versorgungshof", title: "Raffinerie und Versorgungshof", why: "Treibstoff brauchst du für jede Mission, Proviant ernährt deine Truppen.", action: { kind: "building", id: "raffinerie" }, actionText: "Ausbauen" },
  { id: "kz", icon: "kommandozentrale", title: "Kommandozentrale auf Stufe 1", why: "Sie hebt den Deckel für alle anderen Gebäude und gibt mehr Kommandopunkte für größere Verbände.", action: { kind: "building", id: "kommandozentrale" }, actionText: "Zur Kommandozentrale" },
  { id: "kaserne", icon: "kaserne", title: "Kaserne bauen", why: "Nur Bodentruppen können landen, siegen und Beute holen – und deinen Hafen halten.", action: { kind: "building", id: "kaserne" }, actionText: "Zur Kaserne" },
  { id: "wache", icon: "schuetzen", title: `${GOALS.schuetzen} Schützen ausbilden`, why: `Schützen halten deinen Hafen und erobern Piratennester. Mit ${GOALS.schuetzen} Schützen gelingt der erste Überfall auf ein Nest der Stufe 1 (mit 20 fast nie) – und nach dem Anfängerschutz hältst du mehr Überfälle des Kartells auf.`, action: { kind: "tab", tab: "truppen", seg: "ausbilden" }, actionText: "Zur Kaserne" },
  { id: "werft", icon: "werft", title: "Werft bauen", why: "Ohne Schiffe kommst du nicht übers Meer – weder zum Plündern noch zum Handeln.", action: { kind: "building", id: "werft" }, actionText: "Zur Werft" },
  { id: "flotte", icon: "landungsschiff", title: `${GOALS.korvette} Korvetten und ${GOALS.landungsschiff} Landungsschiff`, why: (bal) => {
    const l = bal?.units.landungsschiff;
    return `Das Landungsschiff bringt ${fmtNum(l?.troopSpace ?? 100)} Plätze Truppen an Land und ${fmtNum(l?.cargo ?? 4000)} Beute heim, Korvetten schützen es vor den Schnellbooten stärkerer Nester.`;
  }, action: { kind: "tab", tab: "truppen", seg: "ausbilden" }, actionText: "Schiffe bauen" },
  { id: "nest", icon: "kartell", title: "Ein Piratennest Stufe 1 überfallen", why: nestWhy, action: { kind: "tab", tab: "truppen", seg: "einsatz" }, actionText: "Zu den lohnenden Zielen" },
  { id: "hafen", icon: "hafenkommandantur", title: "Hafenkommandantur auf Stufe 3", why: "Öffnet die Börse: Überschüsse verkaufen, Fehlendes kaufen. Jede zweite Stufe bringt einen Missionsplatz.", action: { kind: "building", id: "hafenkommandantur" }, actionText: "Zur Hafenkommandantur" },
  { id: "schutz", icon: "radarstation", title: "Radarstation und Tiefbunker", why: "Das Radar warnt vor Angriffen, der Bunker schützt einen Grundstock vor Plünderung.", action: { kind: "building", id: "radarstation" }, actionText: "Zur Radarstation" },
];

/** Nest-Auftrag mit der Besatzung von Stufe 1 aus der Balance. */
function nestWhy(bal: Balance | undefined): string {
  const n = bal?.pirates.nestLevels["1"] as Record<string, unknown> | undefined;
  const crew = n
    ? Object.entries(n).filter(([k, v]) => k !== "loot" && typeof v === "number" && v > 0).map(([k, v]) => `${fmtNum(v as number)} ${countLabel(k, v as number)}`).join(" und ")
    : "einige Schnellboote und Milizionäre";
  return `Nester liegen an den Küsten; eines der Stufe 1 liegt höchstens 300 km von deinem Hafen entfernt. Stufe 1 hat ${crew}. Empfohlen: ein Landungsschiff mit mindestens ${GOALS.schuetzen} Schützen, dazu deine Korvetten. Unter Truppen → Einsatz → „Lohnende Ziele“ steht der passende Verband mit seiner Siegchance aus dem Probekampf.`;
}

const whyText = (s: Step, bal: Balance | undefined) => (typeof s.why === "function" ? s.why(bal) : s.why);

/** Bei Schritten mit zwei Gebäuden zum noch fehlenden führen. */
export function nextAction(step: Step, b: BaseData): GuideAction {
  if (step.id === "basis") return { kind: "building", id: lvl(b, "raffinerie") < 1 ? "raffinerie" : "versorgungshof" };
  if (step.id === "schutz") return { kind: "building", id: lvl(b, "radarstation") < 1 ? "radarstation" : "tiefbunker" };
  return step.action;
}

/** Auftragsbuch vom Server; auch für den Zähler an der Navigation genutzt. */
export function useGuide(enabled = true) {
  return useQuery({ ...trpc.guide.get.queryOptions(), enabled, refetchInterval: 60000 });
}

/** Aufträge frisch holen (Auftragsbuch, Tagesbefehle, Wochenziele, Hafen). */
export function refreshQuests(): void {
  for (const f of [trpc.guide.pathFilter(), trpc.base.pathFilter(), trpc.daily.pathFilter(), trpc.achievements.weekly.pathFilter()]) void queryClient.invalidateQueries(f);
}

/**
 * Endet ein Bau- oder Ausbildungs-Countdown im Browser, kurz danach die Aufträge neu holen – zusätzlich zur
 * Live-Meldung, falls diese ausbleibt (Verbindung weg). Sonst zeigt „Nächster Auftrag“ den erledigten Schritt.
 */
export function useRefreshAtCountdowns(base: BaseData): void {
  const next = [...base.buildQueue.map((o) => o.finishesAt), ...base.trainingQueue.map((o) => o.finishesAt)]
    .filter((t) => t > serverNow()).sort((a, b) => a - b)[0];
  useEffect(() => {
    if (next === undefined) return;
    const t = setTimeout(refreshQuests, Math.min(2 ** 31 - 1, next - serverNow() + 1500));
    return () => clearTimeout(t);
  }, [next]);
}

/** Wie viel einer Belohnung über die Lagergrenze ginge (nur im Heimathafen, wohin sie geliefert wird). */
export function overflowOf(base: BaseData, reward: Record<string, number> | undefined): number {
  if (!reward || !base.isHome || !(base.capacity > 0)) return 0;
  let lost = 0;
  for (const [r, n] of Object.entries(reward)) {
    const cur = base.resources[r] ?? 0;
    lost += Math.max(0, n - Math.max(0, base.capacity - cur));
  }
  return Math.round(lost);
}

const invalidate = () => [trpc.guide.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.social.ranking.pathFilter().queryKey];

export function Guide({ base, onAction }: { base: BaseData; onAction: (a: GuideAction) => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const q = useGuide();
  const [showAll, setShowAll] = useState(false);
  const claim = useCommand((i: { key: string; stepId: string }) => trpcClient.guide.claim.mutate(i), invalidate);
  const claimFinal = useCommand((i: { key: string }) => trpcClient.guide.claimFinal.mutate(i), invalidate);
  const g = q.data;
  if (!g || !g.hasBase) return null;
  const byId = new Map(g.steps.map((s) => [s.id, s]));
  const current = STEPS.find((s) => !byId.get(s.id)?.done);
  const open = STEPS.filter((s) => byId.get(s.id)?.claimable);
  const busy = claim.busy || claimFinal.busy;
  return (
    <section className="panel rounded-xl p-3.5 mb-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2">Auftragsbuch</h2>
        <span className="flex items-center gap-2">
          {g.claimable > 0 && <Badge tone="green">{g.claimable} {g.claimable === 1 ? "Belohnung" : "Belohnungen"} abholbar</Badge>}
          <span className="text-xs text-slate-400 mono">{g.doneCount}/{STEPS.length} erledigt</span>
        </span>
      </div>
      <Bar value={g.doneCount / STEPS.length} />
      {open.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {open.map((s) => (
            <li key={s.id} className="flex items-center gap-2 border border-moos/50 bg-moos/5 px-2 py-1.5">
              <Icon id={s.icon} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">{s.title}</span>
                <span className="block text-xs"><ResChips values={byId.get(s.id)!.reward} /></span>
                {overflowOf(base, byId.get(s.id)!.reward) > 0 && (
                  <span className="block text-[11px] text-messing">Lager zu voll: {fmtNum(overflowOf(base, byId.get(s.id)!.reward))} verfielen – die Belohnung bleibt die ganze Saison abholbar.</span>
                )}
              </span>
              <Button className="shrink-0" disabled={busy} onClick={() => void claim.run({ stepId: s.id })}>Abholen</Button>
            </li>
          ))}
        </ul>
      )}
      {open.some((s) => overflowOf(base, byId.get(s.id)?.reward) > 0) && (
        <Button kind="secondary" className="w-full mt-1.5" onClick={() => onAction({ kind: "building", id: "lagerkomplex" })}>Lagerkomplex ausbauen</Button>
      )}
      <ErrorLine text={claim.error ?? claimFinal.error} code={claim.error ? claim.code : claimFinal.code} />
      {current ? (
        <div className="flex gap-3 mt-3">
          <div className="shrink-0 self-start w-16 h-14 grid place-items-center bg-[#f6f1e5] border border-rule"><Icon id={current.icon} size={46} /></div>
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-[19px] leading-tight mb-0.5">{current.title}</h3>
            <p className="text-[13.5px] leading-snug text-ink2">{whyText(current, meta.data?.balance)}</p>
            <p className="mt-1 text-xs text-ink2 flex flex-wrap items-center gap-x-2">Belohnung: <ResChips values={byId.get(current.id)?.reward} /></p>
            {(() => {
              const a = nextAction(current, base);
              // In Arbeit: das Gebäude steht in der Bauschlange (laufend oder eingereiht).
              const pos = a.kind === "building" ? base.buildQueue.findIndex((o) => o.buildingId === a.id) : -1;
              return pos >= 0 ? (
                <p className="mt-2 text-sm text-sea-300">
                  {pos === 0 ? "Wird gerade gebaut – gleich geht es weiter." : `In Arbeit: steht auf Platz ${pos + 1} der Bauschlange.`}
                </p>
              ) : (
                <Button className="mt-2 w-full" onClick={() => runGuideAction(a, onAction)}>{current.actionText}</Button>
              );
            })()}
          </div>
        </div>
      ) : (
        <FinalCard g={g} busy={busy} onClaim={() => void claimFinal.run({})} />
      )}
      <Button kind="ghost" className="w-full mt-2" onClick={() => setShowAll((v) => !v)}>
        {showAll ? "Liste ausblenden" : "Alle Aufträge zeigen"}
      </Button>
      {showAll && (
        <ol className="mt-1 space-y-1">
          {STEPS.map((s) => {
            const st = byId.get(s.id);
            const ok = !!st?.done;
            return (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <span className={`grid place-items-center w-5 h-5 text-xs border ${ok ? "border-moos text-moos" : "border-ink2"}`}>{ok ? "✓" : ""}</span>
                <Icon id={s.icon} size={20} />
                <span className={`min-w-0 flex-1 ${st?.claimed ? "text-slate-400 line-through" : ""}`}>{s.title}</span>
                <span className="text-[11px] text-slate-400">{st?.claimed ? "abgeholt" : st?.claimable ? "abholbar" : ""}</span>
              </li>
            );
          })}
          <li className="flex items-center gap-2 text-sm">
            <span className={`grid place-items-center w-5 h-5 text-xs border ${g.final.claimed ? "border-moos text-moos" : "border-ink2"}`}>{g.final.claimed ? "✓" : ""}</span>
            <Icon id="hafenmeister" size={20} />
            <span className="min-w-0 flex-1">Abschluss: Abzeichen „Hafenmeister“</span>
          </li>
        </ol>
      )}
    </section>
  );
}

/** Abschlusskarte nach allen elf Aufträgen: Paket, Abzeichen und −1 Stunde Bauzeit. */
function FinalCard({ g, busy, onClaim }: { g: GuideData; busy: boolean; onClaim: () => void }) {
  const hours = Math.round(g.final.boostSeconds / 360) / 10;
  const boost = `−${fmtNum(hours)} ${hours === 1 ? "Stunde" : "Stunden"} Bauzeit`;
  return (
    <div className="flex gap-3 mt-3 border border-messing/60 bg-[#f6f1e5] p-2.5">
      <div className="shrink-0 self-start grid place-items-center"><Icon id="hafenmeister" size={56} /></div>
      <div className="min-w-0 flex-1">
        {g.final.claimed ? (
          <>
            <h3 className="font-serif text-[19px] leading-tight mb-0.5">Hafenmeister</h3>
            <p className="text-[13.5px] leading-snug text-ink2">
              Alle Grundaufträge erledigt. Dein Abzeichen steht diese Saison in der Rangliste neben deinem Namen.
              {g.final.boostPending ? ` Gutschrift: ${boost} für deinen nächsten Ausbau.` : ""}
            </p>
            <p className="text-sm mt-2">Baue deine Flotte aus, nimm stärkere Nester ins Visier und handle an der Börse.</p>
          </>
        ) : (
          <>
            <h3 className="font-serif text-[19px] leading-tight mb-0.5">Abschlussbelohnung</h3>
            <p className="text-[13.5px] leading-snug text-ink2">
              Alle elf Aufträge erfüllt. Zur Belohnung: ein großes Paket, das Abzeichen „Hafenmeister“ für diese Saison und
              einmalig {boost} für den laufenden Ausbau (läuft keiner, für den nächsten).
            </p>
            <p className="mt-1 text-xs"><ResChips values={g.final.reward} /></p>
            {g.final.claimable ? (
              <Button className="mt-2 w-full" disabled={busy} onClick={onClaim}>Abschlussbelohnung abholen</Button>
            ) : (
              <p className="mt-2 text-sm text-ink2">Hole zuerst alle Belohnungen der Aufträge ab.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
