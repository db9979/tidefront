// Lage, soziale Zeilen (UX-0.43 C3/L-6/W-6): ungelesene Post von Mitspielern mit Absender, Betreff und „Antworten“
// direkt in „Wartet auf dich“ (höchstens POST_ROWS, der Rest steht in der Sammelzeile „n neue Nachrichten“).
// Antworten öffnet das Schreibblatt der Post; Antippen der Zeile öffnet Meldungen → Post.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../../lib/trpc.ts";
import { Icon } from "../../icons.tsx";
import { ComposeSheet, type Draft } from "../../screens/Messages.tsx";

export const POST_ROWS = 3;

/** Ungelesene Nachrichten von Mitspielern (Systemnachrichten der Hafenmeisterei zählen nur in der Sammelzeile). */
export function useUnreadPost() {
  const inbox = useQuery({ ...trpc.social.messages.inbox.queryOptions(), refetchInterval: 60000 });
  return (inbox.data ?? []).filter((m) => !m.read && m.other).slice(0, POST_ROWS);
}

export function LagePost({ rows, onOpen }: { rows: ReturnType<typeof useUnreadPost>; onOpen: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  return (
    <>
      {rows.map((m) => (
        <li key={m.id} className="border-b border-dotted border-rule last:border-b-0 flex items-center gap-2" data-lage-row="post" data-lage-key={`post:${m.id}`}>
          <button type="button" className="tap flex items-start gap-2.5 py-2 min-w-0 flex-1 text-left" onClick={onOpen}>
            <span className="shrink-0 mt-0.5"><Icon id="nav-bericht" size={24} /></span>
            <span className="min-w-0">
              <span className="block text-sm leading-snug font-semibold truncate">Post von {m.other!.name}</span>
              <span className="block text-xs text-ink2 truncate">{m.subject ?? m.body}</span>
            </span>
          </button>
          <button type="button" data-testid="lage-post-reply" className="tap shrink-0 rounded-lg btn-quiet font-display uppercase tracking-[0.1em] text-[12px] px-3 py-2"
            onClick={() => setDraft({ to: m.other!, subject: (m.subject ? (m.subject.startsWith("Re: ") ? m.subject : `Re: ${m.subject}`) : "").slice(0, 80), body: "" })}>
            Antworten
          </button>
        </li>
      ))}
      {draft && <li className="list-none"><ComposeSheet draft={draft} onClose={() => setDraft(null)} /></li>}
    </>
  );
}
