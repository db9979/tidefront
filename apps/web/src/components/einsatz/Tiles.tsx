// Titel/Hinweise ohne automatische Silbentrennung; lange Wörter mit weichem Trennstrich an der Wortfuge.
// Truppen → Einsatz: Kacheln im Stil der Gebäudekacheln (Basis) für Admirale, Rohstofffelder, Vorlagen und den
// Kampfsimulator. Antippen öffnet die bestehende Ansicht als Blatt; grüne Raute = jetzt möglich (freier Platz).
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, type Balance, type BaseData } from "../../lib/trpc.ts";
import type { Target } from "../../App.tsx";
import { fitUnits, isPlanType, requestPlan } from "../../lib/plan-request.ts";
import { Icon } from "../../icons.tsx";
import { Button, Sheet, UnitChips } from "../../ui.tsx";
import { AdmiralsPanel } from "../Admirals.tsx"; // Admirale
import { MyFieldsPanel, useFields } from "../Fields.tsx"; // Felder
import { FreeSimSheet } from "../SimLauncher.tsx";
import { TileFrame } from "./art.tsx";

type Open = "admirale" | "felder" | "vorlagen" | "simulator" | null;

function Tile({ icon, title, figure, hint, can, onOpen }: { icon: string; title: string; figure?: ReactNode; hint: string; can?: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      className="relative rounded-xl p-2 flex items-center gap-2 text-left border border-rule bg-card min-h-[72px] min-w-0 active:scale-[0.97] transition">
      <TileFrame><Icon id={icon} size={44} /></TileFrame>
      <span className="min-w-0 flex-1">
        <span className="block font-serif text-[14px] leading-tight hyphens-manual">{title}</span>
        {figure !== undefined && <span className="block mono text-[15px] leading-tight mt-0.5">{figure}</span>}
        <span className="block text-[11px] text-ink2 leading-tight mt-0.5 hyphens-manual">{hint}</span>
      </span>
      {can && <span className="absolute top-1.5 left-1.5 diamond bg-moos" title="jetzt möglich" aria-label="jetzt möglich" />}
    </button>
  );
}

export function EinsatzTiles({ base, balance, onShowOnMap }: { base: BaseData; balance: Balance; onShowOnMap: (t: Target) => void }) {
  const [open, setOpen] = useState<Open>(null);
  const adm = useQuery(trpc.admiral.get.queryOptions());
  const fields = useFields();
  const tpl = useQuery(trpc.comfort.templates.queryOptions());
  const a = adm.data;
  const f = fields.data;
  const close = () => setOpen(null);
  const mapAndClose = (t: Target) => { close(); onShowOnMap(t); };
  return (
    <section aria-label="Weitere Werkzeuge" className="mb-3">
      <div className="grid grid-cols-2 gap-2">
        <Tile icon="admiral" title="Admirale" figure={a ? `${a.list.length}/${a.slots}` : "…"} can={!!a && a.list.length < a.slots}
          hint={!a ? "" : a.list.length === 0 ? (a.slots > 0 ? "ernennen möglich" : "noch kein Platz") : a.list.map((x) => x.name).join(", ")} onOpen={() => setOpen("admirale")} />
        <Tile icon="oelfeld" title={"Rohstoff\u00ADfelder"} figure={f ? `${f.mine.length}/${f.maxFields}` : "…"} can={!!f && f.maxFields > 0 && f.mine.length < f.maxFields}
          hint={!f ? "" : f.maxFields === 0 ? "ab Hafen\u00ADkommandantur" : f.mine.length === 0 ? "besetzen möglich" : "Ertrag per Konvoi"} onOpen={() => setOpen("felder")} />
        <Tile icon="geleit" title="Vorlagen" figure={tpl.data ? String(tpl.data.length) : "…"} hint="Verband mit einem Tipp" onOpen={() => setOpen("vorlagen")} />
        <Tile icon="wuerfel" title="Kampfsimulator" hint="Kämpfe durchrechnen" onOpen={() => setOpen("simulator")} />
      </div>

      {open === "admirale" && (
        <Sheet open onClose={close} title={<>Admirale {a && <span className="text-ink2 font-sans text-sm mono">{a.list.length}/{a.slots}</span>}</>} icon={<Icon id="admiral" size={44} />}>
          <AdmiralsPanel />
        </Sheet>
      )}
      {open === "felder" && (
        <Sheet open onClose={close} title={<>Meine Felder {f && <span className="text-ink2 font-sans text-sm mono">{f.mine.length}/{f.maxFields}</span>}</>} icon={<Icon id="besetzen" size={44} />}>
          <MyFieldsPanel base={base} onShowOnMap={mapAndClose} />
        </Sheet>
      )}
      {open === "vorlagen" && (
        <Sheet open onClose={close} title="Vorlagen" icon={<Icon id="geleit" size={44} />}>
          <TemplateList base={base} onPlan={close} />
        </Sheet>
      )}
      {open === "simulator" && <FreeSimSheet balance={balance} base={base} onClose={close} />}
    </section>
  );
}

/** Gespeicherte Verbände (Missionsplanung → Vorlagen): „Planen“ öffnet die Planung mit dieser Zusammensetzung. */
function TemplateList({ base, onPlan }: { base: BaseData; onPlan: () => void }) {
  const list = useQuery(trpc.comfort.templates.queryOptions());
  const home = Object.fromEntries(base.units.map((u) => [u.id, u.home]));
  const rows = list.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-ink2">Noch keine Vorlagen. In der Missionsplanung stellst du einen Verband zusammen und speicherst ihn unter einem Namen, z. B. „Nestjäger“.</p>;
  return (
    <ul className="divide-y divide-rule">
      {rows.map((t) => {
        const fit = fitUnits(t.units, home);
        const none = Object.keys(fit.units).length === 0;
        return (
          <li key={t.id} className="py-2 flex items-center gap-3">
            <Icon id={t.missionType ?? "ueberfall"} size={32} />
            <div className="flex-1 min-w-0">
              <div className="font-serif">{t.name}</div>
              <div className="text-xs"><UnitChips counts={t.units} /></div>
              {fit.short.length > 0 && !none && <div className="text-[11px] text-messing">Daheim nicht vollständig – wird gekürzt.</div>}
            </div>
            <Button kind="secondary" disabled={none} onClick={() => { onPlan(); requestPlan({ target: null, type: isPlanType(t.missionType) ? t.missionType : undefined, units: t.units }); }}>Planen</Button>
          </li>
        );
      })}
    </ul>
  );
}
