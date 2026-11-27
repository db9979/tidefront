// Mehrere Häfen: Hafen verwalten – umbenennen (jeder eigene Hafen) und Kolonie aufgeben (nie der Heimathafen,
// mit Bestätigung). Nach dem Aufgeben fällt der Client auf den Heimathafen zurück (resetActiveBase).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { errorText, fmtNum } from "../lib/names.ts";
import { resetActiveBase } from "../lib/active-base.ts";
import { Icon } from "../icons.tsx";
import { Button, CountsLine, ErrorLine, Sheet } from "../ui.tsx";

const NAME_RE = /^[\p{L}\p{N} _.'’-]{2,32}$/u;

/** Knopf „Hafen verwalten“ mit Blatt (Umbenennen, Aufgeben). */
export function HarborManageButton({ base, className = "" }: { base: BaseData; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`tap text-xs text-see underline ${className}`} aria-label={`Hafen ${base.name} verwalten`}>
        Hafen verwalten
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Hafen ${base.name}`} icon={<Icon id={base.isHome ? "heimathafen" : "gruendung"} size={28} />}>
        {open && <HarborManage base={base} onDone={() => setOpen(false)} />}
      </Sheet>
    </>
  );
}

export function HarborManage({ base, onDone }: { base: BaseData; onDone: () => void }) {
  return (
    <div className="space-y-4">
      <RenameForm base={base} />
      {base.isHome
        ? <p className="text-xs text-ink2">Der Heimathafen lässt sich nicht aufgeben. Forschung, Kredite und Rangliste hängen an ihm.</p>
        : <Abandon base={base} onDone={onDone} />}
    </div>
  );
}

function RenameForm({ base }: { base: BaseData }) {
  const [name, setName] = useState(base.name);
  const rename = useCommand((i: { key: string; name: string; baseId: number }) => trpcClient.base.rename.mutate(i), () => [trpc.base.pathFilter().queryKey, trpc.world.map.queryKey()]);
  const clean = name.trim().replace(/\s+/g, " ");
  const valid = NAME_RE.test(clean);
  const taken = base.bases.some((b) => b.id !== base.id && b.name.toLowerCase() === clean.toLowerCase());
  return (
    <div>
      <div className="font-display text-[11px] uppercase tracking-[0.12em] text-ink2 mb-1">Umbenennen</div>
      <div className="flex gap-2">
        <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} aria-label="Neuer Hafenname"
          className="flex-1 min-w-0 h-11 rounded-lg field px-2" />
        <Button disabled={rename.busy || !valid || taken || clean === base.name} onClick={() => void rename.run({ name: clean, baseId: base.id })}>Speichern</Button>
      </div>
      {!valid && clean.length > 0 && <p className="text-xs text-siegel mt-1">{errorText("bad_base_name")}</p>}
      {taken && <p className="text-xs text-siegel mt-1">{errorText("base_name_taken")}</p>}
      <ErrorLine text={rename.error} />
    </div>
  );
}

function Abandon({ base, onDone }: { base: BaseData; onDone: () => void }) {
  const info = useQuery({ ...trpc.base.abandonInfo.queryOptions({ baseId: base.id }), staleTime: 0 });
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState("");
  const abandon = useCommand((i: { key: string; baseId: number }) => trpcClient.base.abandon.mutate(i), () => []);
  const d = info.data;
  const blockers = d?.blockers ?? [];
  async function go() {
    const r = await abandon.run({ baseId: base.id });
    if (r?.ok) {
      resetActiveBase(); // zurück zum Heimathafen
      onDone();
      await queryClient.invalidateQueries();
    }
  }
  return (
    <div className="rounded-[3px] border border-siegel/60 p-2.5">
      <div className="font-display text-[11px] uppercase tracking-[0.12em] text-siegel mb-1">Kolonie aufgeben</div>
      <p className="text-xs text-ink2">
        Der Außenposten wird gelöscht. Es verfallen alle Bestände, Gebäude, Bau- und Ausbildungsschlangen, die Einheiten
        im Hafen und die Verteidigung. Admirale des Hafens wechseln in den Heimathafen. Hole wertvolle Einheiten und
        Ladung vorher per Verlegung oder Transport in einen anderen Hafen.
      </p>
      {!d ? <p className="text-xs text-ink2 mt-1">Prüfe …</p> : blockers.length > 0 ? (
        <ul className="mt-2 text-xs text-siegel space-y-0.5">
          {blockers.map((c) => <li key={c}>· {errorText(c)}</li>)}
        </ul>
      ) : !confirm ? (
        <Button kind="danger" className="mt-2 w-full" onClick={() => setConfirm(true)}>Kolonie aufgeben …</Button>
      ) : (
        <div className="mt-2 text-sm">
          <div className="text-xs">Verfällt:</div>
          <div className="text-xs"><CountsLine counts={d.resources} /></div>
          {Object.keys(d.units).length > 0 && <div className="text-xs"><CountsLine counts={d.units} /></div>}
          {Object.keys(d.defenses).length > 0 && <div className="text-xs"><CountsLine counts={d.defenses} /></div>}
          <div className="text-xs text-ink2">{fmtNum(d.buildingLevels)} Gebäudestufen{d.admirals > 0 ? ` · ${d.admirals} Admiral${d.admirals > 1 ? "e" : ""} wechselt in den Heimathafen` : ""}</div>
          <label className="block text-xs mt-2">
            Zur Bestätigung den Hafennamen eingeben:
            <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Hafenname zur Bestätigung" className="block w-full mt-0.5 h-11 rounded-lg field px-2" />
          </label>
          <div className="flex gap-2 mt-2">
            <Button kind="secondary" className="flex-1" onClick={() => { setConfirm(false); setTyped(""); }}>Abbrechen</Button>
            <Button kind="danger" className="flex-1" disabled={abandon.busy || typed.trim() !== base.name} onClick={() => void go()}>Endgültig aufgeben</Button>
          </div>
        </div>
      )}
      <ErrorLine text={abandon.error} />
    </div>
  );
}
