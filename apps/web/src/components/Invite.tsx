// Freunde einladen: Einladung per E-Mail oder als persönlicher Link (Teilen/Kopieren) und „Meine Einladungen“.
// Genutzt in den Einstellungen und als Blatt aus der Rangliste.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, queryClient, type Outputs } from "../lib/trpc.ts";
import { errorText } from "../lib/names.ts";
import { Badge, Button, ErrorLine } from "../ui.tsx";

type Mine = Outputs["invite"]["mine"];
type Inv = Mine["invites"][number];

const field = "w-full h-12 rounded-lg field px-3 mb-3";
const MESSAGE_MAX = 500;

function day(ms: number): string {
  return new Date(ms).toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}
function dayTime(ms: number): string {
  return new Date(ms).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Teilen über das Teilen-Menü des Geräts, sonst in die Zwischenablage. Rückgabe: Hinweistext oder null. */
async function shareLink(url: string, inviter?: string): Promise<string | null> {
  const text = `${inviter ? `${inviter} lädt dich` : "Ich lade dich"} zu TIDEFRONT ein – Seekrieg auf Nordatlantik und Mittelmeer, im Browser mit Freunden.`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Einladung zu TIDEFRONT", text, url });
      return null;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return null;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "Link kopiert. Schick ihn deinem Freund – er gilt einmal.";
  } catch {
    return "Kopieren nicht möglich. Bitte den Link oben markieren und kopieren.";
  }
}

const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

function StatusBadge({ i }: { i: Inv }) {
  switch (i.status) {
    case "accepted": return <Badge tone="green">angenommen</Badge>;
    case "sent": return <Badge tone="sea">versandt</Badge>;
    case "open": return <Badge tone="brass">Link offen</Badge>;
    case "expired": return <Badge>abgelaufen</Badge>;
    default: return <Badge tone="red">zurückgezogen</Badge>;
  }
}

/** Formular und Übersicht; playerName für den Teilen-Text. */
export function InvitePanel({ playerName }: { playerName?: string }) {
  const q = useQuery(trpc.invite.mine.queryOptions());
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<{ url: string; code: string; expiresAtMs: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries(trpc.invite.pathFilter());

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
    } catch {
      setError(errorText("network"));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const d = q.data;
  if (!d) return <p className="text-sm text-ink2">Lädt …</p>;
  const full = d.usage.open >= d.limits.maxOpen || d.usage.week >= d.limits.maxWeek;

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await trpcClient.invite.sendEmail.mutate({ email, name: name || undefined, message: message || undefined });
      if (!r.ok) return setError(errorText(r.code));
      setMsg(`Einladung an ${email} ist unterwegs. Sie gilt ${d.limits.days} Tage.`);
      setEmail("");
      setName("");
      setMessage("");
    });
  };
  const makeLink = () => run(async () => {
    const r = await trpcClient.invite.createLink.mutate({ name: name || undefined });
    if (!r.ok) return setError(errorText(r.code));
    setLink({ url: r.url, code: r.code, expiresAtMs: r.expiresAtMs });
    setName("");
    setMsg(await shareLink(r.url, playerName));
  });

  if (!d.allowed) {
    return <p className="text-sm text-ink2">Die Verwaltung hat das Einladen von Freunden gerade abgeschaltet.</p>;
  }

  return (
    <div>
      <p className="text-sm text-ink2 mb-3">
        Lade Freunde in diese Runde ein. Jede Einladung hat einen eigenen Code, gilt einmal und {d.limits.days} Tage.
        Wer ihr folgt, wird dir gemeldet.
      </p>
      <form onSubmit={send}>
        <label className="text-sm text-ink2" htmlFor="inv-name">Name des Freundes (optional)</label>
        <input id="inv-name" className={field} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <label className="text-sm text-ink2" htmlFor="inv-email">E-Mail-Adresse</label>
        <input id="inv-email" className={field} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!d.mailReady} />
        <label className="text-sm text-ink2 flex justify-between" htmlFor="inv-msg">
          <span>Persönliche Nachricht (optional)</span>
          <span className="mono text-xs">{message.length}/{MESSAGE_MAX}</span>
        </label>
        <textarea id="inv-msg" className="w-full rounded-lg field px-3 py-2 mb-3 min-h-24" maxLength={MESSAGE_MAX} value={message}
          onChange={(e) => setMessage(e.target.value)} disabled={!d.mailReady} placeholder="Komm an Bord – wir brauchen noch einen Admiral." />
        {!d.mailReady && (
          <p className="text-sm text-messing mb-2">
            Der E-Mail-Versand ist auf diesem Server nicht eingerichtet. Teile stattdessen deinen persönlichen Link – per Messenger, SMS oder wie du magst.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button type="submit" disabled={busy || !d.mailReady || !email.trim() || full}>Einladung senden</Button>
          <Button kind="secondary" onClick={() => void makeLink()} disabled={busy || full}>Link teilen</Button>
        </div>
      </form>
      <p className="text-xs text-ink2 mt-2 mono">
        Offen {d.usage.open} von {d.limits.maxOpen} · diese Woche {d.usage.week} von {d.limits.maxWeek}
      </p>
      {link && (
        <div className="rounded-lg border border-ink bg-card p-3 mt-3">
          <div className="text-xs text-ink2 mb-1">Dein Einladungslink (einmalig, gültig bis {day(link.expiresAtMs)}):</div>
          <div className="mono text-sm break-all select-all">{link.url}</div>
          <div className="text-xs text-ink2 mt-1">Code: <span className="mono font-semibold select-all">{link.code}</span></div>
          <Button kind="secondary" className="w-full mt-2" onClick={() => void shareLink(link.url, playerName).then(setMsg)}>
            {canShare() ? "Erneut teilen" : "Link kopieren"}
          </Button>
        </div>
      )}
      {msg && <p className="text-sm text-moos mt-2">{msg}</p>}
      <ErrorLine text={error} />
      <MyInvites invites={d.invites} busy={busy} run={run} setError={setError} setMsg={setMsg} playerName={playerName} />
    </div>
  );
}

function MyInvites(props: {
  invites: Inv[];
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  setError: (s: string | null) => void;
  setMsg: (s: string | null) => void;
  playerName?: string;
}) {
  const { invites, busy, run, setError, setMsg } = props;
  if (invites.length === 0) return null;
  const revoke = (i: Inv) => run(async () => {
    const r = await trpcClient.invite.revoke.mutate({ id: i.id });
    if (!r.ok) setError(errorText(r.code));
  });
  const resend = (i: Inv) => run(async () => {
    const r = await trpcClient.invite.resend.mutate({ id: i.id });
    if (!r.ok) setError(errorText(r.code));
    else setMsg(`Einladung an ${i.email} erneut gesendet.`);
  });
  return (
    <div className="mt-4">
      <h3 className="font-display text-[11px] uppercase text-ink2 tracking-[0.16em] mb-1">Meine Einladungen</h3>
      <ul className="divide-y divide-rule">
        {invites.map((i) => (
          <li key={i.id} className="py-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 text-sm">
                <div className="font-semibold truncate">
                  {i.friendName ?? i.email ?? "Link"}
                  {i.friendName && i.email && <span className="font-normal text-ink2"> · {i.email}</span>}
                </div>
                <div className="text-xs text-ink2">
                  {i.status === "accepted" ? `angenommen von ${i.acceptedName ?? "?"}` : `${i.channel === "email" ? "per E-Mail" : "per Link"} · ${day(i.createdAtMs)}`}
                  {(i.status === "sent" || i.status === "open") && ` · gültig bis ${day(i.expiresAtMs)}`}
                </div>
              </div>
              <StatusBadge i={i} />
            </div>
            {(i.canRevoke || (i.resendAtMs !== null && (i.status === "sent" || i.status === "expired"))) && (
              <div className="flex flex-wrap gap-x-3 mt-1">
                {i.url && i.channel === "link" && (
                  <Button kind="ghost" className="!px-0" disabled={busy} onClick={() => void shareLink(i.url!, props.playerName).then(setMsg)}>Link teilen</Button>
                )}
                {i.channel === "email" && (i.status === "sent" || i.status === "expired") && i.resendAtMs !== null && (
                  i.canResend
                    ? <Button kind="ghost" className="!px-0" disabled={busy} onClick={() => void resend(i)}>Erneut senden</Button>
                    : <span className="text-xs text-ink2 self-center">Erneut senden ab {dayTime(i.resendAtMs)}</span>
                )}
                {i.canRevoke && <Button kind="ghost" className="!px-0" disabled={busy} onClick={() => void revoke(i)}>Zurückziehen</Button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
