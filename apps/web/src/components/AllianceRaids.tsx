// Allianz-Ops: Bereich „Sammelangriffe“ im Allianz-Bildschirm – offene Angriffe mit Countdown, Beitritt mit eigener
// Verbandsauswahl, Rückzug und Abbruch; laufende und beendete Angriffe der letzten 24 Stunden.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type Outputs } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { errorText, fmtNum } from "../lib/names.ts";
import { fmtDuration, fmtSeconds, fmtTime, useNow } from "../lib/time.ts";
import { Badge, Button, Card, ErrorLine, Loading, Stepper, UnitChips } from "../ui.tsx";
import { Icon, IconTile } from "../icons.tsx";

type Raid = Outputs["allianceOps"]["raids"]["raids"][number];

const STATUS: Record<string, { text: string; tone: "sea" | "brass" | "slate" | "red" | "green" }> = {
  offen: { text: "Beitritt offen", tone: "sea" },
  ausgelaufen: { text: "Unterwegs", tone: "brass" },
  beendet: { text: "Beendet", tone: "slate" },
  abgebrochen: { text: "Abgebrochen", tone: "red" },
  verfallen: { text: "Ohne Teilnehmer", tone: "slate" },
};

export const invalidateOps = () => [trpc.allianceOps.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.alliance.pathFilter().queryKey];

export function AllianceRaids() {
  const q = useQuery(trpc.allianceOps.raids.queryOptions());
  const base = useQuery(trpc.base.get.queryOptions());
  const now = useNow();
  if (!q.data || !base.data) return <Loading />;
  const { raids, limits } = q.data;
  return (
    <div>
      <Card title={<><Icon id="sammelangriff" size={18} /> Sammelangriffe</>}>
        <p className="text-sm text-ink2">
          Mehrere Verbände der Allianz greifen gemeinsam an und kommen gleichzeitig an. Eröffnen über <strong>Mission planen → Überfall → „als Sammelangriff eröffnen“</strong>.
          Beitritt bis zur Frist; die Beute wird nach Kampfbeitrag geteilt. Höchstens {limits.raid.maxOpenPerAlliance} offene Angriffe, je Angriff {limits.raid.maxParticipants} Verbände.
        </p>
      </Card>
      {raids.length === 0 && <p className="panel rounded-xl p-4 text-sm text-ink2 text-center">Gerade gibt es keinen Sammelangriff.</p>}
      {raids.map((r) => <RaidCard key={r.id} r={r} base={base.data.base} now={now} />)}
    </div>
  );
}

function RaidCard({ r, base, now }: { r: Raid; base: BaseData | null; now: number }) {
  const [joining, setJoining] = useState(false);
  const withdraw = useCommand((i: { key: string; raidId: number }) => trpcClient.allianceOps.withdraw.mutate(i), invalidateOps);
  const cancel = useCommand((i: { key: string; raidId: number }) => trpcClient.allianceOps.cancel.mutate(i), invalidateOps);
  const st = STATUS[r.status] ?? { text: r.status, tone: "slate" as const };
  const open = r.status === "offen" && r.joinDeadlineMs > now;
  return (
    <Card title={<span className="flex items-center gap-2 min-w-0"><Icon id={r.target.kind === "event" ? "kartell" : r.target.kind === "nest" ? "kartell" : "ueberfall"} size={20} /><span className="truncate">{r.target.name}</span></span>} right={<Badge tone={st.tone}>{st.text}</Badge>}>
      <div className="text-sm space-y-1">
        <div className="text-ink2">Feld {r.target.col}/{r.target.row} · eröffnet von {r.creator}</div>
        {r.status === "offen" && (
          <div className="mono">Auslaufen in <strong>{fmtDuration(Math.max(0, r.joinDeadlineMs - now))}</strong> ({fmtTime(r.joinDeadlineMs)})</div>
        )}
        {(r.status === "offen" || r.status === "ausgelaufen") && (
          <div className="mono">
            {r.status === "offen" ? "Ankunft voraussichtlich" : "Ankunft"} {fmtTime(r.arriveAtMs)}
            {r.status === "ausgelaufen" && r.arriveAtMs > now ? ` · in ${fmtDuration(r.arriveAtMs - now)}` : ""}
            {r.arriveAtMs > r.desiredArriveAtMs + 60000 && <span className="text-messing"> · später als gewünscht ({fmtTime(r.desiredArriveAtMs)}): der langsamste Verband bestimmt</span>}
          </div>
        )}
        {r.reportId !== null && <div className="text-ink2">Gemeinsamer Kampfbericht unter <strong>Meldungen → Berichte</strong>.</div>}
      </div>
      <ul className="divide-y divide-rule mt-2">
        {r.participants.map((p, i) => (
          <li key={i} className="py-1.5 text-sm">
            <div className="flex justify-between gap-2"><strong className={p.mine ? "text-see" : ""}>{p.name}{p.mine ? " (du)" : ""}</strong><span className="text-xs text-ink2">{p.status === "staged" ? "bereit" : p.status === "outbound" ? "unterwegs" : p.status === "returning" ? "auf dem Rückweg" : ""}</span></div>
            <div className="text-xs"><UnitChips counts={p.units} /></div>
          </li>
        ))}
      </ul>
      {open && !r.joined && !joining && <Button className="w-full mt-2" onClick={() => setJoining(true)}>Mit eigenem Verband beitreten</Button>}
      {open && joining && base && <JoinForm r={r} base={base} onDone={() => setJoining(false)} />}
      {r.status === "offen" && r.joined && (
        <Button kind="secondary" className="w-full mt-2" disabled={withdraw.busy} onClick={() => { if (confirm("Vom Sammelangriff zurückziehen? Verband und Treibstoff kommen sofort zurück.")) void withdraw.run({ raidId: r.id }); }}>Zurückziehen</Button>
      )}
      {r.canCancel && (
        <Button kind="danger" className="w-full mt-2" disabled={cancel.busy} onClick={() => { if (confirm("Sammelangriff für alle abbrechen?")) void cancel.run({ raidId: r.id }); }}>Abbrechen</Button>
      )}
      <ErrorLine text={withdraw.error ?? cancel.error} />
    </Card>
  );
}

function JoinForm({ r, base, onDone }: { r: Raid; base: BaseData; onDone: () => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const [units, setUnits] = useState<Record<string, number>>({});
  const join = useCommand((i: { key: string; raidId: number; units: Record<string, number> }) => trpcClient.allianceOps.join.mutate(i), invalidateOps);
  const chosen = Object.fromEntries(Object.entries(units).filter(([, n]) => n > 0));
  const input = { type: "ueberfall", units: chosen, col: r.target.col, row: r.target.row, ...(r.target.kind === "event" ? { eventId: r.target.id } : {}) };
  const preview = useQuery({ ...trpc.mission.preview.queryOptions(input), enabled: Object.keys(chosen).length > 0, placeholderData: keepPreviousData });
  const balance = meta.data?.balance;
  const p = preview.data;
  return (
    <div className="mt-2 border-t border-rule pt-2">
      <ul className="divide-y divide-rule">
        {base.units.filter((u) => u.home > 0 && !balance?.units[u.id]?.covert).map((u) => (
          <li key={u.id} className="py-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1"><IconTile id={u.id} size={32} /><div className="text-sm text-ink2 min-w-0">{fmtNum(u.home)} daheim</div></div>
            <Stepper value={units[u.id] ?? 0} max={u.home} onChange={(v) => setUnits({ ...units, [u.id]: v })} />
          </li>
        ))}
      </ul>
      {p && Object.keys(chosen).length > 0 && (
        <p className="text-sm mt-1">
          {p.ok ? <>Reise {fmtSeconds(p.travelSeconds)} · Treibstoff {fmtNum(p.fuelCost)} (wird beim Beitritt gebunden)</> : <span className="text-siegel">{errorText(p.code)}</span>}
        </p>
      )}
      <div className="flex gap-2 mt-2">
        <Button kind="secondary" className="flex-1" onClick={onDone}>Abbrechen</Button>
        <Button className="flex-1" disabled={!p?.ok || join.busy} onClick={async () => { const out = await join.run({ raidId: r.id, units: chosen }); if (out?.ok) onDone(); }}>Beitreten</Button>
      </div>
      <ErrorLine text={join.error} />
    </div>
  );
}
