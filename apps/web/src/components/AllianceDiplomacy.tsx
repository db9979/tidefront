// Diplomatie der eigenen Partei (Allianz oder Spieler ohne Allianz): Pakte, Kriege, Frieden; neue Verträge.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Outputs } from "../lib/trpc.ts";
import { fmtDuration, fmtTime, useNow } from "../lib/time.ts";
import { useAct } from "../lib/act.ts";
import { Badge, Button, Card, ErrorLine, Loading } from "../ui.tsx";
import { Icon } from "../icons.tsx";

type Treaty = Outputs["alliance"]["diplomacy"]["get"]["treaties"][number];

export function AllianceDiplomacy() {
  const v = useQuery(trpc.alliance.diplomacy.get.queryOptions());
  const act = useAct();
  const now = useNow(10000);
  const [party, setParty] = useState("");
  const [war, setWar] = useState(false);
  if (!v.data) return <Loading />;
  const { canAct, treaties, parties } = v.data;
  const run = (fn: () => Promise<{ ok: boolean; code?: string }>) => void act.run(fn);

  return (
    <div>
      <Card title={<><Icon id="schild" size={18} /> Verträge</>}>
        {treaties.length === 0 ? (
          <p className="text-sm text-ink2">Keine Verträge und keine Kriege.</p>
        ) : (
          <ul className="divide-y divide-navy-600/70">
            {treaties.map((t) => (
              <li key={t.id} className="py-2">
                <div className="flex items-center gap-2">
                  <strong className="min-w-0 flex-1 truncate text-sm">{t.other.name}</strong>
                  <StatusBadge t={t} now={now} />
                </div>
                <p className="text-xs text-ink2 mt-0.5">{detail(t, now)}</p>
                {canAct && <Actions t={t} now={now} busy={act.busy} run={run} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canAct ? (
        <Card title="Neuer Vertrag">
          <select aria-label="Gegenüber" className="w-full h-12 rounded-lg field px-2 mb-2" value={party} onChange={(e) => { setParty(e.target.value); setWar(false); }}>
            <option value="">Allianz oder Spieler wählen …</option>
            {parties.map((p) => <option key={p.party} value={p.party}>{p.name}</option>)}
          </select>
          {!war ? (
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={!party || act.busy} onClick={() => run(() => trpcClient.alliance.diplomacy.proposePact.mutate({ party }))}>Pakt anbieten</Button>
              <Button kind="danger" disabled={!party} onClick={() => setWar(true)}>Krieg erklären</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">Krieg erklären? Er beginnt nach 12 Stunden. Im Krieg entfällt bei gegenseitigen Überfällen die Schwachziel-Kürzung der Beute.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button kind="danger" disabled={act.busy} onClick={async () => { await act.run(() => trpcClient.alliance.diplomacy.declareWar.mutate({ party })); setWar(false); }}>Erklären</Button>
                <Button kind="secondary" onClick={() => setWar(false)}>Abbrechen</Button>
              </div>
            </div>
          )}
          <p className="text-[11px] text-ink2 mt-2">Gegenüber sind Allianzen und Spieler ohne Allianz. Ein Pakt gilt, sobald beide Seiten zugestimmt haben.</p>
        </Card>
      ) : (
        <p className="text-sm text-ink2 px-1 mb-3">Verträge schließen Führung und Offiziere deiner Allianz.</p>
      )}
      <ErrorLine text={act.error} />
    </div>
  );
}

function StatusBadge({ t, now }: { t: Treaty; now: number }) {
  if (t.kind === "krieg") return (t.activeFromMs ?? 0) <= now ? <Badge tone="red">Krieg</Badge> : <Badge tone="brass">Krieg erklärt</Badge>;
  if (t.status === "angeboten") return <Badge tone="slate">{t.byUs ? "angeboten" : "Angebot"}</Badge>;
  return t.endsAtMs ? <Badge tone="brass">gekündigt</Badge> : <Badge tone="sea">Pakt</Badge>;
}

function detail(t: Treaty, now: number): string {
  if (t.kind === "krieg") {
    const start = t.activeFromMs ?? 0;
    const head = start > now ? `Beginnt in ${fmtDuration(start - now)} (${fmtTime(start)}).` : `Seit ${fmtTime(start)}.`;
    const by = t.byUs ? "Von uns erklärt." : "Uns erklärt.";
    const peace = t.peace === "wir" ? " Wir haben Frieden angeboten." : t.peace === "sie" ? " Die Gegenseite bietet Frieden an." : "";
    return `${head} ${by}${peace}`;
  }
  if (t.status === "angeboten") return t.byUs ? "Wartet auf Zustimmung der Gegenseite." : "Die Gegenseite bietet einen Nichtangriffspakt an.";
  if (t.endsAtMs) return `Gekündigt, gilt noch ${fmtDuration(Math.max(0, t.endsAtMs - now))} (bis ${fmtTime(t.endsAtMs)}).`;
  return "Gegenseitige Überfälle sind ausgeschlossen. Kündigungsfrist 24 Stunden.";
}

function Actions({ t, now, busy, run }: { t: Treaty; now: number; busy: boolean; run: (fn: () => Promise<{ ok: boolean; code?: string }>) => void }) {
  const d = trpcClient.alliance.diplomacy;
  const btns: [string, () => Promise<{ ok: boolean; code?: string }>, "primary" | "secondary" | "danger"][] = [];
  if (t.kind === "pakt") {
    if (t.status === "angeboten" && !t.byUs) btns.push(["Annehmen", () => d.acceptPact.mutate({ id: t.id }), "primary"], ["Ablehnen", () => d.cancelPact.mutate({ id: t.id }), "secondary"]);
    else if (t.status === "angeboten") btns.push(["Zurückziehen", () => d.cancelPact.mutate({ id: t.id }), "secondary"]);
    else if (!t.endsAtMs) btns.push(["Kündigen", () => d.cancelPact.mutate({ id: t.id }), "danger"]);
  } else {
    const pending = (t.activeFromMs ?? 0) > now;
    if (pending && t.byUs) btns.push(["Zurückziehen", () => d.peace.mutate({ id: t.id }), "secondary"]);
    else if (t.peace === "sie") btns.push(["Frieden annehmen", () => d.peace.mutate({ id: t.id }), "primary"]);
    else if (t.peace === null) btns.push(["Frieden anbieten", () => d.peace.mutate({ id: t.id }), "secondary"]);
  }
  if (btns.length === 0) return null;
  return (
    <div className="flex gap-2 mt-1.5">
      {btns.map(([label, fn, kind]) => <Button key={label} kind={kind} disabled={busy} onClick={() => run(fn)}>{label}</Button>)}
    </div>
  );
}
