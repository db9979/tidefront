// Einstieg in den Kampfsimulator; der Simulator selbst (mit Regelkern) wird erst beim Öffnen nachgeladen.
import { lazy, Suspense, useState } from "react";
import type { Balance, BaseData } from "../lib/trpc.ts";
import type { ProbeTarget } from "./BattleSim.tsx";
import { Icon } from "../icons.tsx";
import { Button, Card, Sheet } from "../ui.tsx";

const ProbeKampf = lazy(() => import("./BattleSim.tsx").then((m) => ({ default: m.ProbeKampf })));
const FreeSim = lazy(() => import("./BattleSim.tsx").then((m) => ({ default: m.FreeSim })));

const Wait = () => <p className="text-sm text-ink2 font-serif italic">Simulator lädt …</p>;

/** Missionsplanung: Knopf „Probekampf“ und Ergebnis darunter. */
export function ProbeCard({ balance, base, units, target, onScout }: { balance: Balance; base: BaseData; units: Record<string, number>; target: ProbeTarget; onScout: () => void }) {
  const [open, setOpen] = useState(false);
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
          <ProbeKampf balance={balance} units={units} versorgungsmangel={base.versorgungsmangel} target={target} onScout={onScout} />
        </Suspense>
      )}
    </Card>
  );
}

/** Truppen: freier Simulator mit beliebigen Verbänden beider Seiten. */
export function FreeSimCard({ balance, base }: { balance: Balance; base: BaseData }) {
  const [open, setOpen] = useState(false);
  return (
    <Card title="Kampfsimulator">
      <div className="flex items-center gap-3">
        <Icon id="korvette" size={36} />
        <p className="text-sm text-ink2 flex-1">Beliebige Verbände gegeneinander antreten lassen – auch das Kartell gegen deinen Hafen.</p>
        <Button kind="secondary" onClick={() => setOpen(true)}>Öffnen</Button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Kampfsimulator" icon={<Icon id="korvette" size={40} />}>
        <Suspense fallback={<Wait />}>
          <FreeSim balance={balance} base={base} />
        </Suspense>
      </Sheet>
    </Card>
  );
}
