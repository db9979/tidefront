// Mitglieder der eigenen Allianz mit Punkten und Rollen; Führung und Offiziere bearbeiten Anfragen und laden ein.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Outputs } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { ROLE_TEXT, useAct } from "../lib/act.ts";
import { Badge, Button, Card, ErrorLine, Sheet, StatTable } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import type { Draft } from "../screens/Messages.tsx";

type View = Outputs["alliance"]["get"];
type Member = NonNullable<View["alliance"]>["members"][number];
const RANK: Record<string, number> = { fuehrung: 3, offizier: 2, mitglied: 1 };

export function AllianceMembers({ data, onCompose }: { data: View; onCompose: (d: Draft) => void }) {
  const a = data.alliance!;
  const officer = a.role !== "mitglied";
  const act = useAct();
  const [open, setOpen] = useState<Member | null>(null);
  return (
    <div>
      <Card title={`Mitglieder (${a.members.length} von ${data.maxSize})`} right={<span className="text-[11px] text-ink2 mono">{fmtNum(a.points)} Punkte</span>}>
        <ul className="divide-y divide-navy-600/70 -mx-1">
          {a.members.map((m) => (
            <li key={m.playerId}>
              <button type="button" onClick={() => setOpen(m)} className={`tap w-full flex items-center gap-2 px-1 py-2 text-left ${m.own ? "bg-sea-400/10 rounded-lg" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{m.name}{m.own && <span className="text-ink2 font-normal"> (du)</span>}</span>
                  <span className="block text-xs text-ink2">dabei seit {fmtTime(m.joinedAtMs)}</span>
                </span>
                {m.role !== "mitglied" && <Badge tone={m.role === "fuehrung" ? "brass" : "sea"}>{ROLE_TEXT[m.role]}</Badge>}
                <span className="w-16 text-right mono tabular-nums">{fmtNum(m.points)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {officer && <Requests data={data} />}
      {officer && <Invite data={data} />}
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? ""} icon={<Icon id="anker" size={28} />}>
        {open && (
          <div className="space-y-3">
            <StatTable rows={[["Rolle", ROLE_TEXT[open.role]], ["Punkte", fmtNum(open.points)], ["Dabei seit", fmtTime(open.joinedAtMs)]]} />
            {!open.own && (
              <Button kind="secondary" className="w-full" onClick={() => { setOpen(null); onCompose({ to: { id: open.playerId, name: open.name }, subject: "", body: "" }); }}>
                Nachricht schreiben
              </Button>
            )}
            {!open.own && a.role === "fuehrung" && (
              <div className="grid grid-cols-3 gap-2">
                {(["mitglied", "offizier", "fuehrung"] as const).map((r) => (
                  <Button key={r} kind="secondary" disabled={act.busy || open.role === r}
                    onClick={async () => { const x = await act.run(() => trpcClient.alliance.setRole.mutate({ playerId: open.playerId, role: r })); if (x?.ok) setOpen(null); }}>
                    {r === "fuehrung" ? "Führung übergeben" : ROLE_TEXT[r]}
                  </Button>
                ))}
              </div>
            )}
            {!open.own && RANK[a.role] > RANK[open.role] && (
              <Button kind="danger" className="w-full" disabled={act.busy}
                onClick={async () => { const x = await act.run(() => trpcClient.alliance.kick.mutate({ playerId: open.playerId })); if (x?.ok) setOpen(null); }}>
                Ausschließen
              </Button>
            )}
            <ErrorLine text={act.error} />
          </div>
        )}
      </Sheet>
    </div>
  );
}

function Requests({ data }: { data: View }) {
  const act = useAct();
  if (data.requests.length === 0) return null;
  return (
    <Card title="Anfragen und Einladungen">
      <ul className="divide-y divide-navy-600/70">
        {data.requests.map((r) => (
          <li key={r.id} className="py-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 text-sm">
              <strong>{r.player.name}</strong>
              <span className="block text-xs text-ink2">{r.kind === "anfrage" ? "möchte beitreten" : "eingeladen"} · {fmtTime(r.atMs)}</span>
            </span>
            {r.kind === "anfrage" && (
              <Button disabled={act.busy} onClick={() => void act.run(() => trpcClient.alliance.accept.mutate({ requestId: r.id }))}>Aufnehmen</Button>
            )}
            <Button kind="secondary" disabled={act.busy} onClick={() => void act.run(() => trpcClient.alliance.decline.mutate({ requestId: r.id }))}>
              {r.kind === "anfrage" ? "Ablehnen" : "Zurückziehen"}
            </Button>
          </li>
        ))}
      </ul>
      <ErrorLine text={act.error} />
    </Card>
  );
}

function Invite({ data }: { data: View }) {
  const ranking = useQuery(trpc.social.ranking.queryOptions());
  const dir = useQuery(trpc.alliance.directory.queryOptions());
  const act = useAct();
  const [to, setTo] = useState<number | null>(null);
  const invited = new Set(data.requests.map((r) => r.player.id));
  const free = (ranking.data?.rows ?? []).filter((r) => !r.own && !dir.data?.players[r.playerId] && !invited.has(r.playerId));
  const full = data.alliance!.members.length >= data.maxSize;
  return (
    <Card title="Einladen">
      <div className="flex gap-2">
        <select aria-label="Spieler einladen" className="flex-1 h-12 rounded-lg field px-2" value={to ?? ""} onChange={(e) => setTo(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">{free.length === 0 ? "Niemand ohne Allianz" : "Spieler wählen …"}</option>
          {free.map((r) => <option key={r.playerId} value={r.playerId}>{r.name}</option>)}
        </select>
        <Button disabled={act.busy || to === null || full}
          onClick={async () => { if (to === null) return; const r = await act.run(() => trpcClient.alliance.invite.mutate({ playerId: to })); if (r?.ok) setTo(null); }}>
          Einladen
        </Button>
      </div>
      {full && <p className="text-xs text-ink2 mt-2">Die Allianz ist voll.</p>}
      <ErrorLine text={act.error} />
    </Card>
  );
}
