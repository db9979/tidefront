// Allianz-Chat: die letzten 100 Zeilen, neue kommen per WebSocket (Meldung alliance).
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "../lib/trpc.ts";
import { fmtTime } from "../lib/time.ts";
import { useAct } from "../lib/act.ts";
import { Button, ErrorLine, Loading } from "../ui.tsx";

const MAX = 500;

export function AllianceChat() {
  const chat = useQuery(trpc.alliance.chat.list.queryOptions());
  const act = useAct();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const last = chat.data?.at(-1)?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [last]);
  if (!chat.data) return <Loading />;

  const send = async () => {
    const r = await act.run(() => trpcClient.alliance.chat.send.mutate({ body: text }));
    if (r?.ok) setText("");
  };

  return (
    <div>
      <div className="panel rounded-xl p-3 mb-3 max-h-[55vh] overflow-y-auto">
        {chat.data.length === 0 ? (
          <p className="text-sm text-ink2 italic text-center py-4">Noch still im Funkraum. Schreib die erste Zeile.</p>
        ) : (
          <ul className="space-y-2">
            {chat.data.map((m) => (
              <li key={m.id} className={`flex ${m.own ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-1.5 border ${m.own ? "bg-card border-ink" : "bg-paper border-rule"}`}>
                  <div className="text-[11px] text-ink2 flex gap-2 justify-between">
                    <strong className="font-serif text-ink">{m.own ? "du" : m.name}</strong>
                    <span className="tabular-nums">{fmtTime(m.atMs)}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div ref={end} />
      </div>
      <div className="flex gap-2 items-end">
        <textarea aria-label="Nachricht an die Allianz" className="flex-1 min-h-12 max-h-32 rounded-lg field p-3 text-sm" placeholder="Nachricht an die Allianz"
          maxLength={MAX} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) void send(); } }} />
        <Button disabled={act.busy || text.trim().length === 0} onClick={() => void send()}>Senden</Button>
      </div>
      <ErrorLine text={act.error} code={act.code} />
    </div>
  );
}
