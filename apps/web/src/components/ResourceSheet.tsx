// Infoblatt einer Ressource (Tipp in der Kopfleiste): Art und Verwendung, Bestand und Lager, Produktion nach Quellen,
// Verbrauch, Zeit bis voll/leer, Bunkerschutz, Börsenkurs und Wert des Bestands.
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtTime } from "../lib/time.ts";
import { Bar, Sheet } from "../ui.tsx";
import { Icon } from "../icons.tsx";

const INFO: Record<string, { kind: string; text: string; source: string }> = {
  stahl: {
    kind: "Baustoff",
    text: "Grundstoff für fast alles: Gebäude, Schiffe, Fahrzeuge und Verteidigungsanlagen.",
    source: "stahlwerk",
  },
  treibstoff: {
    kind: "Betriebsstoff",
    text: "Jede Mission verbraucht Treibstoff für die Fahrt. Das Kraftwerk verbrennt ihn für Strom. Auch für Flugzeuge und manche Bauten.",
    source: "raffinerie",
  },
  elektronik: {
    kind: "Hochtechnik",
    text: "Knapp und wertvoll: für Radar, Forschung, U-Boote, Flugzeuge, Spione und Admirale.",
    source: "chipfabrik",
  },
  proviant: {
    kind: "Versorgung",
    text: "Alle Truppen essen Proviant, auch unterwegs. Fällt der Vorrat auf 0 bei negativem Saldo, herrscht Versorgungsmangel: keine Ausbildung, Angriff −20 %.",
    source: "versorgungshof",
  },
};

function Row({ k, v, tone }: { k: string; v: string; tone?: "plus" | "minus" | "muted" }) {
  const cls = tone === "plus" ? "text-moos" : tone === "minus" ? "text-siegel" : tone === "muted" ? "text-ink2" : "";
  return (
    <>
      <span className="text-slate-400">{k}</span>
      <span className={`text-right mono ${cls}`}>{v}</span>
    </>
  );
}

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${fmtNum(Math.abs(n), Math.abs(n) < 10 ? 1 : 0)}/h`;

export function ResourceSheet({ base, res, amount, onClose }: { base: BaseData; res: string; amount: number; onClose: () => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const market = useQuery({ ...trpc.market.get.queryOptions(), staleTime: 60000 });
  const info = INFO[res];
  const b = meta.data?.balance;
  const net = base.rates[res] ?? 0;
  const building = (base as { buildingRates?: Record<string, number> }).buildingRates?.[res] ?? 0;
  const trickle = b?.baseTricklePerHour[res] ?? 0;
  const other = net - trickle - building; // Unterhalt (Proviant), Kraftwerk (Treibstoff)
  const src = info?.source;
  const level = src ? base.buildings.find((x) => x.id === src)?.level ?? 0 : 0;
  const cap = base.capacity;
  const fill = Math.min(1, amount / Math.max(1, cap));
  const price = market.data?.resources.find((r) => r.id === res)?.price;
  const powerCut = base.power && base.power.factor < 0.999 && building > 0;
  const now = Date.now();
  const untilFull = net > 0 && amount < cap ? ((cap - amount) / net) * 3600000 : null;
  const untilEmpty = net < 0 && amount > 0 ? (amount / -net) * 3600000 : null;
  const prodMods = base.modifierSources
    .map((s) => ({ name: s.label, f: (s.mods as { production?: Record<string, number> }).production?.[res] }))
    .filter((x) => typeof x.f === "number" && Math.abs((x.f as number) - 1) > 0.001);

  return (
    <Sheet open onClose={onClose} title={<>{label(res)} <span className="text-ink2 font-sans text-sm">· {info?.kind ?? "Ressource"}</span></>} icon={<Icon id={res} size={48} />}>
      <div className="text-sm space-y-3">
        {info && <p className="text-slate-300">{info.text}</p>}

        <div className="rounded-xl bg-paper border border-rule p-2">
          <div className="flex justify-between items-baseline gap-2">
            <span className="font-serif text-2xl mono">{fmtNum(amount)}</span>
            <span className="text-xs text-ink2 mono">Lager {fmtNum(cap)} · {Math.round(fill * 100)} %</span>
          </div>
          <Bar value={fill} tone={fill >= 0.999 ? "brass" : res === "proviant" && net < 0 ? "red" : "sea"} />
          <div className="text-xs mt-1">
            {fill >= 0.999
              ? <span className="text-messing">Lager voll – Produktion geht verloren. Lagerkomplex ausbauen oder verkaufen.</span>
              : untilFull !== null
                ? <>Voll in {fmtDuration(untilFull)} <span className="text-ink2">· {fmtTime(now + untilFull)} Uhr</span></>
                : untilEmpty !== null
                  ? <span className="text-siegel">Leer in {fmtDuration(untilEmpty)} · {fmtTime(now + untilEmpty)} Uhr</span>
                  : <span className="text-ink2">Bestand bleibt gleich.</span>}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-ink2 mb-1">Produktion je Stunde</div>
          <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            <Row k={src ? `${label(src)} (Stufe ${level})` : "Gebäude"} v={signed(building)} tone={building > 0 ? "plus" : "muted"} />
            <Row k="Grundproduktion des Hafens" v={signed(trickle)} tone="plus" />
            {Math.abs(other) > 0.05 && <Row k={res === "proviant" ? "Truppen essen (Unterhalt)" : res === "treibstoff" ? "Kraftwerk verbrennt" : "Verbrauch"} v={signed(other)} tone="minus" />}
            <span className="font-semibold">Saldo</span>
            <span className={`text-right mono font-semibold ${net < 0 ? "text-siegel" : "text-moos"}`}>{signed(net)}</span>
          </div>
          {level === 0 && src && <p className="text-xs text-brass-300 mt-1">Noch kein {label(src)} – nur die kleine Grundproduktion läuft.</p>}
          {powerCut && <p className="text-xs text-siegel mt-1">Strommangel: Die Gebäude laufen nur zu {Math.round(base.power.factor * 100)} %.</p>}
          {prodMods.map((m) => (
            <p key={m.name} className={`text-xs mt-0.5 ${(m.f as number) < 1 ? "text-siegel" : "text-moos"}`}>
              {m.name}: Produktion {(m.f as number) >= 1 ? "+" : "−"}{Math.round(Math.abs((m.f as number) - 1) * 100)} %
            </p>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
          <Row k="Bunkerschutz (vor Beute sicher)" v={fmtNum(Math.min(amount, base.bunkerProtection))} />
          {price !== undefined && (
            <>
              <Row k="Börsenkurs" v={`${fmtNum(price, 3)} Kr`} />
              <Row k="Wert des Bestands" v={`${fmtNum(amount * price)} Kr`} tone="muted" />
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
