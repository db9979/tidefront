// Allianz: ohne Allianz gründen oder beitreten; mit Allianz Übersicht, Chat, Mitglieder und Diplomatie.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Outputs } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { ROLE_TEXT, useAct } from "../lib/act.ts";
import { Badge, Button, Card, ErrorLine, Loading, StatTable } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import { AllianceChat } from "../components/AllianceChat.tsx";
import { AllianceMembers } from "../components/AllianceMembers.tsx";
import { AllianceDiplomacy } from "../components/AllianceDiplomacy.tsx";
import { AllianceRaids } from "../components/AllianceRaids.tsx"; // Allianz-Ops
import type { Draft } from "./Messages.tsx";
import { HScroll } from "../components/HScroll.tsx";

type View = Outputs["alliance"]["get"];
type Sub = "uebersicht" | "chat" | "mitglieder" | "diplomatie" | "sammelangriffe";

export function AllianceScreen({ onCompose }: { onCompose: (d: Draft) => void }) {
  const v = useQuery(trpc.alliance.get.queryOptions());
  const [sub, setSub] = useState<Sub>("uebersicht");
  if (!v.data) return <Loading />;
  const own = v.data.alliance;
  const subs: { id: Sub; label: string }[] = own
    ? [{ id: "uebersicht", label: "Übersicht" }, { id: "chat", label: "Chat" }, { id: "mitglieder", label: "Mitglieder" }, { id: "sammelangriffe", label: "Angriffe" }, { id: "diplomatie", label: "Diplomatie" }]
    : [{ id: "uebersicht", label: "Übersicht" }, { id: "diplomatie", label: "Diplomatie" }];
  const active = subs.some((s) => s.id === sub) ? sub : "uebersicht";
  return (
    <div>
      <div className="mb-3"><HScroll className="gap-1" role="tablist" label="Allianz" watch={active}>
        {subs.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={active === s.id} onClick={() => setSub(s.id)}
            className={`tap shrink-0 flex-auto rounded-lg px-2 text-xs font-semibold ${active === s.id ? "bg-ink text-paper" : "bg-navy-950/60 text-slate-400"}`}>
            {s.label}
          </button>
        ))}
      </HScroll></div>
      {active === "diplomatie" ? <AllianceDiplomacy /> : !own ? <NoAlliance data={v.data} /> : active === "chat" ? (
        <AllianceChat />
      ) : active === "sammelangriffe" ? (
        <AllianceRaids />
      ) : active === "mitglieder" ? (
        <AllianceMembers data={v.data} onCompose={onCompose} />
      ) : (
        <Overview data={v.data} />
      )}
    </div>
  );
}

function NoAlliance({ data }: { data: View }) {
  const dir = useQuery(trpc.alliance.directory.queryOptions());
  const act = useAct();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const pendingIds = new Set(data.invitations.filter((r) => r.kind === "anfrage").map((r) => r.alliance.id));
  return (
    <div>
      {data.invitations.length > 0 && (
        <Card title="Einladungen und Anfragen">
          <ul className="divide-y divide-navy-600/70">
            {data.invitations.map((r) => (
              <li key={r.id} className="py-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm">
                  <strong>[{r.alliance.tag}] {r.alliance.name}</strong>
                  <span className="block text-xs text-ink2">{r.kind === "einladung" ? "lädt dich ein" : "deine Anfrage"} · {fmtTime(r.atMs)}</span>
                </span>
                {r.kind === "einladung" && (
                  <Button disabled={act.busy} onClick={() => void act.run(() => trpcClient.alliance.accept.mutate({ requestId: r.id }))}>Beitreten</Button>
                )}
                <Button kind="secondary" disabled={act.busy} onClick={() => void act.run(() => trpcClient.alliance.decline.mutate({ requestId: r.id }))}>
                  {r.kind === "einladung" ? "Ablehnen" : "Zurückziehen"}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {/* UX-0.43 C3/M-4: Leerzustand mit Nutzen und Handlung. */}
      <div className="panel rounded-xl p-3.5 mb-3 flex items-start gap-3" data-testid="alliance-empty">
        <Icon id="sammelangriff" size={40} className="shrink-0" />
        <div className="min-w-0 text-sm">
          <strong className="font-serif text-[16px]">Noch ohne Allianz</strong>
          <p className="text-ink2">Verbündete überfallen sich nicht, sprechen sich im Chat ab, greifen gemeinsam an, verteidigen einander mit und teilen Strom per Seekabel.</p>
          <Button kind="secondary" className="mt-2" onClick={() => document.getElementById("allianz-gruenden")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Allianz gründen</Button>
        </div>
      </div>
      <Card title={`Allianzen (${dir.data?.alliances.length ?? 0})`}>
        {!dir.data ? <Loading /> : dir.data.alliances.length === 0 ? (
          <p className="text-sm text-ink2">Noch keine Allianz in der Runde – gründe die erste und lade Mitspieler ein.</p>
        ) : (
          <ul className="divide-y divide-navy-600/70">
            {dir.data.alliances.map((a) => (
              <li key={a.id} className="py-2 flex items-center gap-2">
                <span className="w-6 text-right mono text-ink2">{a.rank}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <strong>[{a.tag}] {a.name}</strong>
                  <span className="block text-xs text-ink2 truncate">{a.members} von {data.maxSize} · Ø {fmtNum(a.total)} Punkte{a.description ? ` · ${a.description}` : ""}</span>
                </span>
                <Button kind="secondary" disabled={act.busy || pendingIds.has(a.id) || a.members >= data.maxSize}
                  onClick={() => void act.run(() => trpcClient.alliance.request.mutate({ allianceId: a.id }))}>
                  {pendingIds.has(a.id) ? "Angefragt" : "Anfragen"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card id="allianz-gruenden" title="Allianz gründen">
        <div className="space-y-2">
          <input aria-label="Name" className="w-full h-12 rounded-lg field px-3" placeholder="Name (3–32 Zeichen)" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Kürzel" className="w-full h-12 rounded-lg field px-3 mono uppercase" placeholder="Kürzel (2–4 Zeichen)" maxLength={4} value={tag} onChange={(e) => setTag(e.target.value.replace(/[^\p{L}\p{N}]/gu, ""))} />
          <textarea aria-label="Beschreibung" className="w-full min-h-20 rounded-lg field p-3 text-sm" placeholder="Beschreibung (optional)" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button className="w-full" disabled={act.busy || name.trim().length < 3 || tag.length < 2}
            onClick={() => void act.run(() => trpcClient.alliance.create.mutate({ name, tag: tag.toUpperCase(), description }))}>
            Gründen
          </Button>
        </div>
      </Card>
      <ErrorLine text={act.error} code={act.code} />
      <p className="text-[11px] text-ink2 px-1">Verbündete können sich nicht überfallen. Allianzen bestehen über das Saisonende hinaus.</p>
    </div>
  );
}

function Overview({ data }: { data: View }) {
  const a = data.alliance!;
  const me = useQuery(trpc.auth.me.queryOptions());
  const dir = useQuery(trpc.alliance.directory.queryOptions());
  const act = useAct();
  const [edit, setEdit] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"leave" | "dissolve" | null>(null);
  const officer = a.role !== "mitglied";
  const rank = dir.data?.alliances.find((x) => x.id === a.id)?.rank;
  return (
    <div>
      <Card title={<><Icon id="anker" size={18} /> [{a.tag}] {a.name}</>} right={<Badge tone="brass">{ROLE_TEXT[a.role]}</Badge>}>
        {edit === null ? (
          <p className="text-sm whitespace-pre-wrap break-words mb-2">{a.description || <span className="text-ink2 italic">Keine Beschreibung.</span>}</p>
        ) : (
          <textarea aria-label="Beschreibung" className="w-full min-h-24 rounded-lg field p-3 text-sm mb-2" maxLength={500} value={edit} onChange={(e) => setEdit(e.target.value)} />
        )}
        {officer && (
          <div className="flex gap-2 mb-2">
            {edit === null ? (
              <Button kind="ghost" onClick={() => setEdit(a.description)}>Beschreibung ändern</Button>
            ) : (
              <>
                <Button disabled={act.busy} onClick={async () => { const r = await act.run(() => trpcClient.alliance.update.mutate({ description: edit })); if (r?.ok) setEdit(null); }}>Speichern</Button>
                <Button kind="secondary" onClick={() => setEdit(null)}>Abbrechen</Button>
              </>
            )}
          </div>
        )}
        <StatTable rows={[
          ["Mitglieder", `${a.members.length} von ${data.maxSize}`],
          ["Allianzpunkte", fmtNum(a.points)],
          ["Platz der Allianzwertung", rank ? `${rank} von ${dir.data?.alliances.length}` : "–"],
          ["Gegründet", fmtTime(a.createdAtMs)],
        ]} />
      </Card>
      {/* UX 0.43 (M-3): Austreten/Auflösen eingeklappt und als Umriss-Knöpfe; die Allianz-Höchstgröße steht nur in der Verwaltung. */}
      <Card title="Mitgliedschaft" collapsible defaultOpen={false} storageKey="allianz-mitgliedschaft">
        {confirm === null ? (
          <div className="grid grid-cols-2 gap-2">
            <Button kind="secondary" onClick={() => setConfirm("leave")}>Austreten</Button>
            {a.role === "fuehrung" && <Button kind="secondary" className="!text-siegel !border-siegel" onClick={() => setConfirm("dissolve")}>Auflösen</Button>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">
              {confirm === "leave"
                ? a.role === "fuehrung" && a.members.length > 1 ? "Austreten? Die Führung geht an den dienstältesten Offizier (sonst das dienstälteste Mitglied)." : "Wirklich austreten?"
                : "Allianz wirklich auflösen? Mitglieder, Chat und Verträge gehen verloren."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button kind="danger" disabled={act.busy}
                onClick={() => void act.run(() => confirm === "leave" ? trpcClient.alliance.leave.mutate() : trpcClient.alliance.dissolve.mutate())}>
                {confirm === "leave" ? "Austreten" : "Auflösen"}
              </Button>
              <Button kind="secondary" onClick={() => setConfirm(null)}>Abbrechen</Button>
            </div>
          </div>
        )}
      </Card>
      <ErrorLine text={act.error} code={act.code} />
    </div>
  );
}
