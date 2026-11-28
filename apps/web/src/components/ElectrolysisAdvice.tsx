// Gebäudeblatt der Elektrolyse (v1.38, Welle 5, M-06): was die nächste Stufe nach der Stromvorhersage der nächsten
// Stunden bringt und ob sie sich lohnt. Rechnung in game-core (electrolysisAdvice), Daten aus der Stromkurve der Basis.
import { electrolysisAdvice, ELECTROLYSIS_GOOD_DAYS, type Balance as CoreBalance } from "@tidefront/game-core";
import type { Balance, BaseData } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";

export function ElectrolysisAdvice({ base, level, balance }: { base: BaseData; level: number; balance: Balance }) {
  const a = electrolysisAdvice(base.grid.curve, level, balance as unknown as CoreBalance);
  if (!a) return null;
  const days = a.paybackDays;
  return (
    <p className={`text-sm mb-3 ${a.worth ? "text-moos" : "text-brass-300"}`} data-testid="electrolysis-advice">
      Nach der Stromvorhersage ({base.grid.curve.length} h) brächte Stufe {level + 1} etwa <strong className="mono">{fmtNum(a.extraFuelPerDay, 1)}</strong> Treibstoff je Tag mehr
      {days === null ? " – es bleibt kein Ökostrom übrig. Erst mehr Wind und Sonne bauen (Überschuss nach Bedarf und Speicher)."
        : a.worth ? ` – die Baukosten sind in etwa ${fmtNum(Math.ceil(days))} Tagen wieder drin.`
        : ` – die Baukosten wären erst nach etwa ${fmtNum(Math.ceil(days))} Tagen wieder drin (lohnend bis ${ELECTROLYSIS_GOOD_DAYS} Tage). Erst mehr Wind und Sonne bauen.`}
    </p>
  );
}
