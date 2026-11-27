// Weltpolitik: Gesuche der KI-Spieler bei den Tagesbefehlen (docs/REGELN-WELTPOLITIK.md, Abschnitt 4). Ein offenes
// Angebot steht über den drei Befehlen (Annehmen schließt den Liefervertrag und belegt einen Platz, Ablehnen gibt den
// Lohn zurück); ein angenommenes Gesuch zeigt im belegten Platz Lieferung, Fälligkeit und Lohn.
import { useState } from "react";
import { trpcClient } from "../../lib/trpc.ts";
import { useCommand } from "../../lib/command.ts";
import { fmtNum, label } from "../../lib/names.ts";
import { fmtDuration, fmtTime, useCountdownNow } from "../../lib/time.ts";
import { Icon } from "../../icons.tsx";
import { Button, ErrorLine, ResChips } from "../../ui.tsx";
import { politikInvalidate, usePolitikKi, type PolitikKi } from "./use-politik.ts";

type Gesuch = PolitikKi["gesuche"][number];
type Res = { ok: boolean; code?: string };

/** Offene Angebote (status angeboten) über den Tagesbefehlen. */
export function GesuchOffers() {
  const q = usePolitikKi();
  const offers = (q.data?.gesuche ?? []).filter((g) => g.status === "angeboten" && g.expiresMs > Date.now());
  if (offers.length === 0) return null;
  return <>{offers.map((g) => <GesuchOffer key={g.id} g={g} />)}</>;
}

function GesuchOffer({ g }: { g: Gesuch }) {
  const now = useCountdownNow(g.expiresMs);
  const [done, setDone] = useState<string | null>(null);
  const accept = useCommand((i: { key: string; gesuchId: number }) => trpcClient.politik.acceptGesuch.mutate(i) as Promise<Res>, politikInvalidate);
  const decline = useCommand((i: { key: string; gesuchId: number }) => trpcClient.politik.declineGesuch.mutate(i) as Promise<Res>, politikInvalidate);
  const busy = accept.busy || decline.busy;
  return (
    <div className="mb-2 rounded-lg border border-messing bg-inset p-2.5" data-testid="gesuch-offer" role="group" aria-label={`Gesuch von ${g.kiName}`}>
      <div className="flex items-start gap-2">
        <Icon id={g.resource} size={28} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase font-display text-ink2">Gesuch von {g.kiName} ({g.profileText})</p>
          <p className="font-serif text-[15.5px] leading-tight">Liefere {fmtNum(g.qty)} {label(g.resource)} – per Liefervertrag</p>
          <div className="text-xs mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ink2">Lohn zusätzlich zum Kaufpreis:</span><ResChips values={g.reward} /><span className="text-ink2">· Ansehen +5</span>
          </div>
          <p className="text-[11px] text-ink2 mt-0.5">Angebot gilt noch <span className="mono">{fmtDuration(g.expiresMs - now)}</span>. Annehmen belegt einen Tagesbefehl-Platz.</p>
        </div>
      </div>
      {done && <p className="text-sm text-moos mt-1 font-semibold" role="status">{done}</p>}
      <div className="flex flex-wrap gap-2 mt-2 justify-end">
        <Button kind="ghost" className="whitespace-nowrap px-3" disabled={busy} onClick={() => void decline.run({ gesuchId: g.id })}>Ablehnen</Button>
        <Button className="whitespace-nowrap px-3" disabled={busy} onClick={async () => {
          const r = await accept.run({ gesuchId: g.id });
          if (r?.ok) setDone("Angenommen – der Liefervertrag steht unter Börse → Verträge.");
        }}>Annehmen</Button>
      </div>
      <ErrorLine text={accept.error ?? decline.error} code={accept.code ?? decline.code} />
    </div>
  );
}

/** Im belegten Tagesbefehl-Platz (Art gesuch, param = Gesuch-ID): Stand des Gesuchs. */
export function GesuchSlotInfo({ id }: { id: number }) {
  const q = usePolitikKi();
  const g = q.data?.gesuche.find((x) => x.id === id);
  const now = useCountdownNow(g?.dueMs);
  if (!g) return null;
  const state = g.status === "erfuellt" ? "erfüllt – Lohn im Heimathafen" : g.status === "gescheitert" ? "gescheitert" : g.status === "angenommen" ? "Liefervertrag läuft" : g.status;
  return (
    <div className="text-xs mt-1" data-testid="gesuch-slot">
      <span>Für {g.kiName}: {fmtNum(g.qty)} {label(g.resource)} · {state}</span>
      {g.status === "angenommen" && g.dueMs && <span className="text-ink2"> · fällig in <span className="mono">{fmtDuration(g.dueMs - now)}</span> ({fmtTime(g.dueMs, now)})</span>}
      <div className="flex flex-wrap items-center gap-x-2 mt-0.5"><span className="text-ink2">Lohn:</span><ResChips values={g.reward} /></div>
    </div>
  );
}
