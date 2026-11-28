// Nachrichten: Posteingang und Gesendet, Lesen markiert als gelesen, Antworten, neue Nachricht.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient, type Outputs } from "../lib/trpc.ts";
import { errorText, failText } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { Button, ErrorLine, Loading, Sheet } from "../ui.tsx";
import { Icon } from "../icons.tsx";

type Msg = Outputs["social"]["messages"]["inbox"][number];
export interface Draft { to: { id: number; name: string } | null; subject: string; body: string }

const SYSTEM = "Hafenmeisterei";
const MAX = 2000;

const SEND_ERRORS: Record<string, string> = {
  self: "Du kannst dir nicht selbst schreiben.",
  empty: "Die Nachricht ist leer.",
};

export function MessagesScreen({ setCompose }: { setCompose: (d: Draft) => void }) {
  const [box, setBox] = useState<"inbox" | "sent">("inbox");
  const [open, setOpen] = useState<Msg | null>(null);
  const inbox = useQuery(trpc.social.messages.inbox.queryOptions());
  const sent = useQuery({ ...trpc.social.messages.sent.queryOptions(), enabled: box === "sent" });
  const list = box === "inbox" ? inbox : sent;

  const show = async (m: Msg) => {
    setOpen(m);
    if (box === "inbox" && !m.read) {
      await trpcClient.social.messages.read.mutate({ id: m.id });
      await queryClient.invalidateQueries(trpc.social.messages.pathFilter());
    }
  };
  const reply = (m: Msg) => {
    if (!m.other) return;
    const subject = m.subject ? (m.subject.startsWith("Re: ") ? m.subject : `Re: ${m.subject}`) : "";
    setOpen(null);
    setCompose({ to: m.other, subject: subject.slice(0, 80), body: "" });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="flex rounded-lg bg-navy-950/70 p-0.5 flex-1" role="tablist">
          {(["inbox", "sent"] as const).map((b) => (
            <button key={b} type="button" role="tab" aria-selected={box === b} onClick={() => setBox(b)}
              className={`tap flex-1 rounded-md text-sm font-semibold ${box === b ? "bg-ink text-paper" : "text-slate-400"}`}>
              {b === "inbox" ? "Posteingang" : "Gesendet"}
            </button>
          ))}
        </div>
        <Button kind="secondary" onClick={() => setCompose({ to: null, subject: "", body: "" })}>Neu</Button>
      </div>
      {!list.data ? <Loading /> : list.data.length === 0 ? (
        <div className="panel rounded-xl p-4 text-center text-slate-300 text-sm">
          {box === "inbox" ? "Keine Nachrichten. Mitspieler findest du in der Rangliste." : "Du hast noch nichts gesendet."}
        </div>
      ) : (
        <ul className="space-y-2">
          {list.data.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => void show(m)}
                className={`tap w-full text-left panel rounded-xl p-3 border-l-4 ${box === "inbox" && !m.read ? "!border-l-sea-400" : "!border-l-transparent"}`}>
                <div className="flex justify-between gap-2 text-sm">
                  <strong className={`min-w-0 truncate ${box === "inbox" && !m.read ? "text-ink font-bold" : "text-slate-300"}`}>
                    {box === "sent" ? "an " : ""}{m.other?.name ?? SYSTEM}
                  </strong>
                  <span className="text-xs text-slate-400 shrink-0 tabular-nums">{fmtTime(m.atMs)}</span>
                </div>
                <div className="text-sm truncate">{m.subject ?? <span className="text-slate-400">(ohne Betreff)</span>}</div>
                <div className="text-xs text-slate-400 truncate">{m.body}</div>
                {box === "sent" && <div className="text-[11px] text-slate-500">{m.read ? "gelesen" : "ungelesen"}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open?.subject ?? "(ohne Betreff)"} icon={<Icon id="nav-bericht" size={28} />}>
        {open && (
          <>
            <p className="text-xs text-slate-400 mb-3">
              {box === "inbox" ? "von" : "an"} <strong className="text-slate-200">{open.other?.name ?? SYSTEM}</strong> · {fmtTime(open.atMs)}
            </p>
            <p className="text-sm whitespace-pre-wrap break-words mb-4">{open.body}</p>
            {open.other && (
              <Button className="w-full" onClick={() => reply(open)}>{box === "inbox" ? "Antworten" : "Weitere Nachricht"}</Button>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}

/** Nachricht verfassen; ohne Empfänger mit Auswahl aus der Spielerliste. */
export function ComposeSheet({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const ranking = useQuery({ ...trpc.social.ranking.queryOptions(), enabled: draft.to === null });
  const [to, setTo] = useState<number | null>(draft.to?.id ?? null);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const others = (ranking.data?.rows ?? []).filter((r) => !r.own);

  // Sperre ohne Render-Verzögerung: zwei Tipps im selben Moment senden nur einmal.
  const sending = useRef(false);
  const send = async () => {
    if (to === null || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await trpcClient.social.messages.send.mutate({ toPlayerId: to, subject: subject.trim() || undefined, body });
      if (!r.ok) setError(SEND_ERRORS[r.code] ?? errorText(r.code));
      else {
        setDone(true);
        await queryClient.invalidateQueries(trpc.social.messages.pathFilter());
        setTimeout(onClose, 700);
      }
    } catch (err) {
      setError(failText(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={draft.to ? `An ${draft.to.name}` : "Neue Nachricht"} icon={<Icon id="nav-bericht" size={28} />}>
      <div className="space-y-2">
        {draft.to === null && (
          <select aria-label="Empfänger" className="w-full h-12 rounded-lg field px-2" value={to ?? ""}
            onChange={(e) => setTo(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">Empfänger wählen …</option>
            {others.map((r) => <option key={r.playerId} value={r.playerId}>{r.name}{r.base ? ` (${r.base.name})` : ""}</option>)}
          </select>
        )}
        <input aria-label="Betreff" className="w-full h-12 rounded-lg field px-3" placeholder="Betreff (optional)"
          maxLength={80} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea aria-label="Text" className="w-full min-h-36 rounded-lg field p-3 text-sm" placeholder="Deine Nachricht"
          maxLength={MAX} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400 tabular-nums">{body.length} / {MAX}</span>
          <Button disabled={busy || done || to === null || body.trim().length === 0} onClick={() => void send()}>
            {done ? "Gesendet" : "Senden"}
          </Button>
        </div>
        <ErrorLine text={error} />
      </div>
    </Sheet>
  );
}
