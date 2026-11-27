// Einstieg in den Kampfsimulator; der Simulator selbst (mit Regelkern) wird erst beim Öffnen nachgeladen.
import { lazy, Suspense, useMemo, useState } from "react";
import type { Balance, BaseData } from "../lib/trpc.ts";
import type { ProbeTarget } from "./BattleSim.tsx";
import { Icon } from "../icons.tsx";
import { Button, Card, Sheet } from "../ui.tsx";
import { modLineText, withAdmiralMods } from "./Admirals.tsx"; // Admirale: Wirkung im Probekampf

const ProbeKampf = lazy(() => import("./BattleSim.tsx").then((m) => ({ default: m.ProbeKampf })));
const FreeSim = lazy(() => import("./BattleSim.tsx").then((m) => ({ default: m.FreeSim })));

const Wait = () => <p className="text-sm text-ink2 font-serif italic">Simulator lädt …</p>;

/** Missionsplanung: Knopf „Probekampf“ und Ergebnis darunter. */
export function ProbeCard({ balance, base, units, target, onScout, admiral }: { balance: Balance; base: BaseData; units: Record<string, number>; target: ProbeTarget; onScout: () => void; admiral?: { name: string; lines: { spec: string; path: string; factor: number }[] } }) {
  const [open, setOpen] = useState(false);
  const modifiers = useMemo(() => withAdmiralMods(base.modifiers, admiral?.lines ?? []), [base.modifiers, admiral]);
  return (
    <Card title="Probekampf" right={open ? <Button kind="ghost" onClick={() => setOpen(false)}>Ausblenden</Button> : undefined}>
      {!open ? (
        <div className="flex items-center gap-3">
          <Icon id="zerstoerer" size={36} />
          <p className="text-sm text-ink2 flex-1">Den Kampf vor dem Auslaufen 50-mal durchrechnen: Siegchance, Verluste, Beute.</p>
          <Button kind="secondary" onClick={() => setOpen(true)}>Probekampf</Button>
        </div>
      ) : (
        <Suspense fallback={<Wait />}>
          {admiral && <p className="text-xs text-ink2 mb-2" data-testid="probe-admiral">Mit {admiral.name}: {modLineText(admiral.lines) || "keine Wirkung auf diesen Verband"}.</p>}
          <ProbeKampf balance={balance} units={units} versorgungsmangel={base.versorgungsmangel} modifiers={modifiers} target={target} onScout={onScout} />
        </Suspense>
      )}
    </Card>
  );
}

/** Truppen → Einsatz (Kachel „Kampfsimulator“): freier Simulator mit beliebigen Verbänden beider Seiten im Blatt. */
export function FreeSimSheet({ balance, base, onClose }: { balance: Balance; base: BaseData; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Kampfsimulator" icon={<Icon id="korvette" size={40} />}>
      <Suspense fallback={<Wait />}>
        <FreeSim balance={balance} base={base} />
      </Suspense>
    </Sheet>
  );
}
