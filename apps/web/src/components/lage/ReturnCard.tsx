// Rückkehrkarte „Seit deinem letzten Besuch“ (UX 0.43, B1 / Entscheidung E-3b): ereignisgesteuert – erscheint nur,
// wenn seit der letzten Quittung etwas passiert ist (Kampf, Bau/Ausbildung fertig, Rangänderung, Nachricht,
// Produktion über 10 % des Lagers) oder eine neue App-Version Neues bringt („Neu in Version …“ gebündelt, O-4).
// Schließen oder „Alle abholen“ quittiert (lage.ack, Serverzeitstempel player.lage_ack_at – geräteübergreifend).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, trpc } from "../../lib/trpc.ts";
import { fmtNum, label } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { useNav } from "../../lib/nav.ts";
import { Icon } from "../../icons.tsx";
import { Sheet } from "../../ui.tsx";
import { APP_VERSION, NewReleases, useVersionNotice } from "../Changelog.tsx";

/** Quittung (Schließen, Abholen): Karte verschwindet, Version gilt als gesehen. */
export function useLageAck(playerId: number | null) {
  const v = useVersionNotice(playerId);
  const m = useMutation({ ...trpc.lage.ack.mutationOptions(), onSuccess: () => void queryClient.invalidateQueries(trpc.lage.since.queryFilter()) });
  return () => { v.markSeen(); m.mutate(); };
}

const amountsText = (m: Record<string, number>, sign = "+") =>
  Object.entries(m).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${sign}${fmtNum(Math.round(v))} ${label(k)}`).join(" · ");

function since(fromMs: number, toMs: number): string {
  const d = new Date(fromMs);
  const sameDay = new Date(toMs).toDateString() === d.toDateString();
  const at = d.toLocaleString("de-DE", sameDay ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return `seit ${at} Uhr · ${fmtDuration(toMs - fromMs)}`;
}

export function ReturnCard({ playerId, onAck }: { playerId: number | null; onAck: () => void }) {
  const nav = useNav();
  const q = useQuery({ ...trpc.lage.since.queryOptions(), refetchInterval: 5 * 60000 });
  const version = useVersionNotice(playerId);
  const [news, setNews] = useState(false);
  const d = q.data;
  if (!d || (!d.show && !version.unseen)) return null;
  const lines: { key: string; icon: string; text: string; tone?: "gut" | "alarm"; go?: () => void }[] = [];
  if (d.battles.total > 0) {
    const lost = d.battles.total - d.battles.won;
    const loot = amountsText(d.battles.lootGained);
    const plundered = amountsText(d.battles.lootLost, "−");
    lines.push({ key: "kampf", icon: "ueberfall", tone: lost > 0 && d.battles.won === 0 ? "alarm" : "gut",
      text: `${d.battles.total} ${d.battles.total === 1 ? "Kampf" : "Kämpfe"}: ${d.battles.won} gewonnen${lost ? `, ${lost} verloren` : ""}${loot ? ` · Beute ${loot}` : ""}${plundered ? ` · geplündert ${plundered}` : ""}`,
      go: () => nav.go({ to: "meldungen", sub: "berichte" }) });
  }
  const built = d.done.builds.length;
  if (built > 0 || d.done.trainings > 0) {
    const parts = [built > 0 ? d.done.builds.slice(0, 2).join(", ") + (built > 2 ? ` und ${built - 2} weitere` : "") : "",
      d.done.trainings > 0 ? `${d.done.trainings} ${d.done.trainings === 1 ? "Ausbildung" : "Ausbildungen"} fertig` : ""].filter(Boolean);
    lines.push({ key: "bau", icon: "kran", text: parts.join(" · "), go: () => nav.go({ to: "base" }) });
  }
  if (d.rank && d.rank.before !== null && d.rank.before !== d.rank.now) {
    const up = d.rank.now < d.rank.before;
    lines.push({ key: "rang", icon: "hafenmeister", tone: up ? "gut" : "alarm", text: `Platz ${d.rank.before} → ${d.rank.now} von ${d.rank.of}`, go: () => nav.go({ to: "meldungen", sub: "saison" }) });
  }
  if (d.messages.count > 0) {
    const first = d.messages.items[0];
    const who = first ? `${first.from ?? "Hafenmeisterei"}${first.subject ? `: ${first.subject}` : ""}` : "";
    lines.push({ key: "post", icon: "nav-bericht", text: `${d.messages.count} ${d.messages.count === 1 ? "neue Nachricht" : "neue Nachrichten"}${who ? ` · ${who}` : ""}`, go: () => nav.go({ to: "meldungen", sub: "nachrichten" }) });
  }
  if (d.production) lines.push({ key: "produktion", icon: "stahlwerk", text: `Produziert etwa ${amountsText(d.production.amounts)}` });
  if (version.unseen) lines.push({ key: "version", icon: "anker", text: `Neu in Version ${APP_VERSION} – was ist neu?`, go: () => setNews(true) });
  const close = () => { version.markSeen(); onAck(); };
  return (
    <section className="panel rounded-xl p-3 mb-3 border-see border-l-4" aria-label="Seit deinem letzten Besuch" data-testid="lage-return">
      <div className="flex items-start gap-2 mb-0.5">
        <span className="flex-1 min-w-0">
          <h2 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2">Seit deinem letzten Besuch</h2>
          <span className="block text-[11px] text-ink2 mono" data-testid="lage-return-range">{since(d.fromMs, d.toMs)}{d.capped ? " (letzte 3 Tage)" : ""}</span>
        </span>
        <button type="button" className="tap -mt-1 -mr-1 rounded-lg text-ink2 px-2" aria-label="Rückblick schließen" onClick={close}>✕</button>
      </div>
      <ul>
        {lines.map((l) => (
          <li key={l.key} data-return={l.key}>
            <button type="button" disabled={!l.go} onClick={l.go} className="tap w-full flex items-center gap-2 py-1 text-left text-[13.5px] leading-snug disabled:cursor-default">
              <Icon id={l.icon} size={20} className="shrink-0" />
              <span className={`min-w-0 flex-1 ${l.tone === "gut" ? "text-moos" : l.tone === "alarm" ? "text-siegel" : ""}`}>{l.text}</span>
              {l.go && <span aria-hidden className="text-ink2">›</span>}
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={news} onClose={() => setNews(false)} title={`Neu in Version ${APP_VERSION}`}>
        <NewReleases since={version.seen} />
      </Sheet>
    </section>
  );
}
