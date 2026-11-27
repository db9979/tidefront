// Allianz-Ops in anderen Bildschirmen: „als Sammelangriff eröffnen“ (Missionsplanung), Stationierung (Truppen:
// Rückruf, Gäste im Hafen heimschicken), gemeinsamer Kampfbericht (Tabelle) und Handbuch-Kapitel.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Balance, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtDuration, fmtTime, useNow } from "../lib/time.ts";
import { Button, Card, ErrorLine, ResChips, UnitChips } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import { invalidateOps } from "./AllianceRaids.tsx";

type Counts = Record<string, number>;
type Limits = { raid: { minJoinMinutes: number; maxJoinHours: number; maxArriveHours: number; maxOpenPerAlliance: number; maxParticipants: number }; station: { maxPerBase: number } };
const DEFAULT_LIMITS: Limits = { raid: { minJoinMinutes: 15, maxJoinHours: 24, maxArriveHours: 48, maxOpenPerAlliance: 3, maxParticipants: 8 }, station: { maxPerBase: 3 } };

export function opsLimits(b: Balance | undefined): Limits {
  return (b as unknown as { allianceOps?: Limits } | undefined)?.allianceOps ?? DEFAULT_LIMITS;
}

function minutesText(m: number): string {
  return fmtDuration(m * 60_000); // einheitlich: „30 min“, „2 h“, „1 T“
}

/** Missionsplanung (Überfall): denselben Verband als Sammelangriff der Allianz eröffnen. */
export function RaidOpenCard({ balance, target, units, travelSeconds, ok, onDone }: {
  balance: Balance; target: { col: number; row: number; eventId?: number }; units: Counts; travelSeconds: number | null; ok: boolean; onDone: (arriveAtMs: number) => void;
}) {
  const al = useQuery(trpc.alliance.get.queryOptions());
  const lim = opsLimits(balance).raid;
  const joinChoices = [15, 30, 60, 120, 240, 480, 720, 1440].filter((m) => m >= lim.minJoinMinutes && m <= lim.maxJoinHours * 60);
  const [join, setJoin] = useState(joinChoices[1] ?? joinChoices[0] ?? lim.minJoinMinutes);
  const [extra, setExtra] = useState(0);
  const now = useNow(60_000); // „Ankunft frühestens“ läuft mit der Uhr mit
  const open = useCommand(
    (i: { key: string; col: number; row: number; eventId?: number; units: Counts; joinMinutes: number; arriveMinutes: number }) => trpcClient.allianceOps.open.mutate(i),
    invalidateOps,
  );
  if (!al.data?.alliance) return null;
  const arriveMinutes = Math.min(lim.maxArriveHours * 60, join + extra);
  const earliest = now + join * 60000 + (travelSeconds ?? 0) * 1000;
  return (
    <Card title={<><Icon id="sammelangriff" size={18} /> Als Sammelangriff eröffnen</>}>
      <p className="text-xs text-ink2 mb-2">Deine Allianz kann bis zur Frist mit eigenen Verbänden beitreten. Alle laufen so aus, dass sie gleichzeitig ankommen; die Beute wird nach Kampfbeitrag geteilt.</p>
      <label className="text-sm flex items-center justify-between gap-2 mb-1">Beitrittsfrist
        <select className="bg-card border border-rule rounded px-2 min-h-[44px]" value={join} onChange={(e) => setJoin(Number(e.target.value))}>
          {joinChoices.map((m) => <option key={m} value={m}>{minutesText(m)}</option>)}
        </select>
      </label>
      <label className="text-sm flex items-center justify-between gap-2">Gewünschte Ankunft nach der Frist
        <select className="bg-card border border-rule rounded px-2 min-h-[44px]" value={extra} onChange={(e) => setExtra(Number(e.target.value))}>
          {[0, 15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m === 0 ? "so früh wie möglich" : `+ ${minutesText(m)}`}</option>)}
        </select>
      </label>
      <p className="text-xs text-ink2 mt-1">Ankunft frühestens {fmtTime(Math.max(earliest, now + arriveMinutes * 60000))} – ein langsamerer Verband verschiebt sie.</p>
      <Button
        className="w-full mt-2"
        disabled={!ok || open.busy || Object.keys(units).length === 0}
        onClick={async () => {
          const r = await open.run({ col: target.col, row: target.row, ...(target.eventId ? { eventId: target.eventId } : {}), units, joinMinutes: join, arriveMinutes });
          if (r?.ok) onDone(Math.max(earliest, Date.now() + arriveMinutes * 60000));
        }}
      >Sammelangriff eröffnen</Button>
      <ErrorLine text={open.error} code={open.code} />
    </Card>
  );
}

type MissionData = BaseData["missions"][number];

/** Truppen: Status-Zeile und Knopf für Sammelangriff-Teilnahmen und Stationierungen. */
export function OpsMissionLine({ m }: { m: MissionData }) {
  const release = useCommand((i: { key: string; missionId: number }) => trpcClient.allianceOps.stationRelease.mutate(i), invalidateOps);
  if (m.status === "staged") {
    return <div className="text-sea-300">Sammelangriff: bereit, Ankunft voraussichtlich {fmtTime(m.arriveAtMs)} · Rückzug im Allianz-Bildschirm</div>;
  }
  if (m.status !== "stationed") return null;
  return (
    <div>
      <div className="text-sea-300">Stationiert – verteidigt mit</div>
      <div className="mt-1"><Button kind="secondary" disabled={release.busy} onClick={() => void release.run({ missionId: m.id })}>Zurückrufen</Button></div>
      <ErrorLine text={release.error} code={release.code} />
    </div>
  );
}

/** Truppen: verbündete Verbände im eigenen Hafen (Gastgeber), mit „Heimschicken“. */
export function StationedGuestsCard({ base, now }: { base: BaseData; now: number }) {
  const release = useCommand((i: { key: string; missionId: number }) => trpcClient.allianceOps.stationRelease.mutate(i), invalidateOps);
  const s = base.stationed;
  if (!s || s.guests.length === 0) return null;
  return (
    <Card title={<><Icon id="stationierung" size={18} /> Verbündete im Hafen {s.guests.filter((g) => g.status === "stationed").length}/{s.max}</>}>
      <ul className="divide-y divide-rule">
        {s.guests.map((g) => (
          <li key={g.missionId} className="py-2 text-sm">
            <div className="flex justify-between gap-2"><strong>{g.owner}</strong><span className="text-xs text-ink2">{g.status === "stationed" ? "verteidigt mit" : `trifft ein in ${fmtDuration(Math.max(0, g.arriveAtMs - now))}`}</span></div>
            <div className="text-xs"><UnitChips counts={g.units} /></div>
            {g.status === "stationed" && (
              <div className="mt-1"><Button kind="secondary" disabled={release.busy} onClick={() => { if (confirm(`Truppen von ${g.owner} heimschicken?`)) void release.run({ missionId: g.missionId }); }}>Heimschicken</Button></div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink2 mt-1">Stationierte Truppen verteidigen deinen Hafen mit; Verluste und Unterhalt trägt ihr Besitzer.</p>
      <ErrorLine text={release.error} code={release.code} />
    </Card>
  );
}

type Part = { playerId: number; name: string; share: number; cargo: number; loot: Counts; outcome: { before: Counts; losses: Counts; final: Counts } };
type Guest = { playerId: number; name: string; before: Counts; losses: Counts };

const lossSum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);

/** Kampfbericht: Tabelle der Teilnehmer eines Sammelangriffs und stationierten Verteidiger. */
export function AllianceOpsReport({ d }: { d: Record<string, unknown> }) {
  const raid = d.allianceRaid as { tag: string; participants: Part[] } | undefined;
  const guests = Array.isArray(d.guests) ? (d.guests as Guest[]) : [];
  if (!raid && guests.length === 0) return null;
  return (
    <>
      {raid && (
        <Card title={<><Icon id="sammelangriff" size={18} /> Sammelangriff [{raid.tag}]</>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink2"><th className="py-1 pr-2">Teilnehmer</th><th className="pr-2 text-right">Beitrag</th><th className="pr-2">Verluste</th><th>Beute</th></tr></thead>
              <tbody>
                {raid.participants.map((p) => (
                  <tr key={p.playerId} className="border-t border-rule align-top">
                    <td className="py-1.5 pr-2 font-semibold">{p.name}</td>
                    <td className="pr-2 text-right mono whitespace-nowrap">{fmtNum(p.share, 1)} %</td>
                    <td className="pr-2 text-xs">{lossSum(p.outcome.losses) > 0 ? <UnitChips counts={p.outcome.losses} /> : "–"}</td>
                    <td className="text-xs"><ResChips values={p.loot} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink2 mt-1">Beitrag = Kampfwert (Lebenspunkte × Angriff) der eingesetzten Einheiten vor dem Kampf. Jeder lädt höchstens seinen Laderaum; der Rest geht nach gleichem Schlüssel an die anderen.</p>
        </Card>
      )}
      {guests.length > 0 && (
        <Card title={<><Icon id="stationierung" size={18} /> Stationierte Verteidiger</>}>
          <ul className="text-sm divide-y divide-rule">
            {guests.map((g) => <li key={g.playerId} className="py-1.5"><strong>{g.name}</strong> · Verluste: {lossSum(g.losses) > 0 ? <UnitChips counts={g.losses} /> : "keine"}</li>)}
          </ul>
        </Card>
      )}
    </>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

/** Handbuch-Kapitel „Sammelangriff und Stationierung“. */
export function AllianceOpsChapter({ b }: { b: Balance | undefined }) {
  const l = opsLimits(b);
  return (
    <>
      <P><strong>Sammelangriff:</strong> Jedes Allianzmitglied kann in der Missionsplanung einen Überfall <strong>als Sammelangriff eröffnen</strong> – gegen einen feindlichen Hafen (dieselben Schutzregeln wie beim Überfall: keine Verbündeten, keine Paktpartner, kein geschützter Hafen), ein Piratennest, die Großflotte oder einen Belagerungsring. Du wählst eine Beitrittsfrist ({l.raid.minJoinMinutes} min bis {l.raid.maxJoinHours} h) und die gewünschte Ankunft.</P>
      <P>Bis zur Frist treten Mitglieder im Allianz-Bildschirm unter <strong>Sammelangriffe</strong> mit eigenen Verbänden bei (höchstens {l.raid.maxParticipants}). Jeder Verband belegt einen Missionsplatz im eigenen Hafen; Einheiten und Treibstoff sind ab dem Beitritt gebunden. Wer vor dem Auslaufen zurückzieht, bekommt alles sofort zurück. Eröffner, Führung und Offiziere können abbrechen.</P>
      <P>Zur Frist laufen alle so aus, dass sie <strong>gleichzeitig ankommen</strong> – der langsamste Verband (mit Sturm auf der Route) bestimmt die Ankunft, notfalls später als gewünscht. Danach ist nur noch der normale Rückruf möglich; ein zurückgerufener Verband kommt nicht mehr an. Das Radar des Ziels warnt einmal für den ganzen Angriff.</P>
      <P>Am Ziel kämpfen alle Verbände als <strong>eine Streitmacht</strong> in einem einzigen Kampf; die Forschung und Veteranen jedes Teilnehmers wirken anteilig. Verluste trägt jeder für seine Einheiten. Die <strong>Beute</strong> wird nach <strong>Kampfbeitrag</strong> geteilt: Anteil = Kampfwert (Lebenspunkte × Angriff) der eingesetzten Einheiten vor dem Kampf. Jeder lädt höchstens seinen Laderaum, der Rest geht nach demselben Schlüssel an die anderen. Alle Teilnehmer und das Ziel erhalten denselben Kampfbericht mit Beitrag, Verlusten und Beute je Teilnehmer.</P>
      <P><strong>Stationierung:</strong> Über <strong>Mission planen → Stationieren</strong> schickst du Schiffe, Landtruppen und Flugzeuge (keine Spione) in den Hafen eines Verbündeten. Dort verteidigen sie bei jedem Angriff mit; Verluste und Unterhalt trägt der Besitzer, der Missionsplatz bleibt belegt. Sie bleiben, bis du sie zurückrufst oder der Gastgeber sie heimschickt; verlässt einer von euch die Allianz, fahren sie automatisch heim. Je Hafen höchstens {l.station.maxPerBase} verbündete Verbände.</P>
    </>
  );
}
