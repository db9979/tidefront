// Aufholhilfe: Baugutschrift sichtbar machen – schmale Zeile unter der Ressourcenleiste, Zeile im Bauhof, Erklärblatt und
// die Verrechnung in den Baukosten (die Gutschrift wird zuerst verbraucht, game-core splitBuildCost).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { splitBuildCost, type Balance as CoreBalance } from "@tidefront/game-core";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { Cost, Sheet } from "../ui.tsx";

type CatchUp = NonNullable<BaseData["catchUp"]>;

const pct = (x: number) => `${fmtNum(Math.round(x * 100))} %`;

/** Teil der Kosten, den das Lager zahlt, und Teil aus der Baugutschrift (ohne Gutschrift: alles aus dem Lager). */
export function useBuildCost(base: BaseData, cost: Record<string, number> | null): { stock: Record<string, number> | null; credit: Record<string, number> | null } {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  return buildCostSplit(base, cost, meta.data?.balance as CoreBalance | undefined);
}

export function buildCostSplit(base: BaseData, cost: Record<string, number> | null, balance: CoreBalance | undefined) {
  const credit = base.catchUp?.credit ?? 0;
  if (!cost || !balance || credit <= 0) return { stock: cost, credit: null };
  const s = splitBuildCost(cost, credit, balance);
  return { stock: s.fromStock, credit: Object.keys(s.fromCredit).length ? s.fromCredit : null };
}

/** Kosten im Info-Blatt: verrechnet „aus der Baugutschrift“ und „aus dem Lager“. */
export function CreditCost({ credit, stock, have }: { credit: Record<string, number>; stock: Record<string, number>; have: Record<string, number> }) {
  return (
    <div className="text-xs space-y-1" data-testid="kosten-gutschrift">
      <div className="flex flex-wrap items-center gap-x-2"><span className="text-moos">Baugutschrift (Aufholhilfe):</span> <Cost cost={credit} /></div>
      <div className="flex flex-wrap items-center gap-x-2"><span className="text-ink2">aus dem Lager:</span> <Cost cost={stock} have={have} /></div>
    </div>
  );
}

/** Schmale Zeile unter der Ressourcenleiste (nur mit Gutschrift oder laufender Hilfe). */
export function CatchUpStrip({ base }: { base: BaseData }) {
  const [open, setOpen] = useState(false);
  const c = base.catchUp;
  if (!c || (c.credit <= 0 && !(c.active && c.bonus > 0))) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="gutschrift-leiste"
        className="w-full flex items-center gap-1.5 px-2 pb-1 text-[11px] text-left text-moos"
        aria-label={`Baugutschrift ${fmtNum(c.credit)} aus der Aufholhilfe – Erklärung`}>
        <Icon id="kommandozentrale" size={14} className="shrink-0" />
        <span className="mono font-semibold">Baugutschrift {fmtNum(c.credit)}</span>
        <span className="text-ink2 truncate">· Aufholhilfe{c.active && c.bonus > 0 ? ` +${pct(c.bonus)}` : ""} · nur für Gebäude</span>
      </button>
      {open && <CatchUpSheet c={c} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Zeile im Bauhof: Betrag, Herkunft, Erklärung. */
export function CatchUpLine({ base }: { base: BaseData }) {
  const [open, setOpen] = useState(false);
  const c = base.catchUp;
  if (!c || (c.credit <= 0 && !(c.active && c.bonus > 0))) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="gutschrift-bauhof"
        className="tap w-full mt-2 pt-2 border-t border-dotted border-rule flex items-center gap-2 text-left text-xs text-ink2">
        <Icon id="lagerkomplex" size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="font-display uppercase tracking-[0.08em] text-ink mr-1">Baugutschrift</span>
          <span className="mono text-moos font-semibold">{fmtNum(c.credit)}</span> · Herkunft: Aufholhilfe
          {c.pack > 0 ? " (mit Startpaket)" : ""}{c.active && c.bonus > 0 ? ` · Zufluss +${pct(c.bonus)} der Gebäudeproduktion` : ""}.
          {" "}Wird beim Bauen zuerst verrechnet.
        </span>
        <span aria-hidden>›</span>
      </button>
      {open && <CatchUpSheet c={c} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Erklärblatt der Aufholhilfe. */
export function CatchUpSheet({ c, onClose }: { c: CatchUp; onClose: () => void }) {
  const r = c.rules;
  return (
    <Sheet open onClose={onClose} title="Aufholhilfe · Baugutschrift" icon={<Icon id="lagerkomplex" size={40} />}>
      <div className="text-sm space-y-2" data-testid="gutschrift-erklaerung">
        <p>
          Bestand: <strong className="mono">{fmtNum(c.credit)}</strong> (zum Börsen-Richtwert, Stahl = 1).
          {c.ratio !== null && <> Dein Ausbau liegt bei <strong>{pct(c.ratio)}</strong> des Medians aller Häfen.</>}
          {c.active && c.bonus > 0 ? <> Zufluss jetzt: <strong>+{pct(c.bonus)}</strong> deiner Gebäudeproduktion je Stunde.</> : <> Zurzeit kein Zufluss.</>}
        </p>
        <p>
          Wer im Ausbau weit hinter dem Median liegt, bekommt stündlich eine Baugutschrift: ab unter {pct(r.from)} des Medians
          steigend, voll (+{pct(r.cap)} der Gebäudeproduktion) ab {pct(r.full)} und darunter. Ab {pct(r.from)} endet sie und beginnt erst
          unter {pct(r.resumeBelow)} wieder. Höchstbestand: {fmtNum(r.storeHours)} Stunden Zufluss.
        </p>
        <p>
          Die Gutschrift bezahlt <strong>nur Gebäude</strong> und wird beim Ausbau zuerst verrechnet (gleicher Anteil jeder Ressource),
          den Rest zahlt das Lager. Sie liegt nicht im Lager, kann nicht geplündert, gehandelt oder verschickt werden und verfällt
          zum Saisonende. Bauzeiten bleiben gleich.
        </p>
        {(c.pack > 0 || c.earned > 0) && (
          <p className="text-ink2">
            Bisher erhalten: {c.pack > 0 ? <>Startpaket {fmtNum(c.pack)}</> : null}{c.pack > 0 && c.earned > 0 ? ", " : ""}{c.earned > 0 ? <>Zufluss {fmtNum(c.earned)}</> : null}.
          </p>
        )}
      </div>
    </Sheet>
  );
}
