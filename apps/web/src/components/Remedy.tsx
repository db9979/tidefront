// „Was hilft?“ unter Sperr- und Fehlermeldungen: aufklappbarer Hinweis mit Sprungknöpfen (lib/remedies, lib/nav).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Balance as CoreBalance } from "@tidefront/game-core";
import { trpc } from "../lib/trpc.ts";
import { useNav } from "../lib/nav.ts";
import { errorText } from "../lib/names.ts";
import { REMEDIES, remedy, type Remedy, type RemedyDetail } from "../lib/remedies/index.ts";
import { SmallButton } from "../ui.tsx";

/** Gibt es zu diesem Code überhaupt einen Hinweis? */
export function hasRemedy(code: string | null | undefined): boolean {
  return !!code && Object.hasOwn(REMEDIES, code);
}

/** Abhilfe zum Code mit aktivem Hafen und Balance (null: nichts zu tun). */
export function useRemedy(code: string | null | undefined, detail?: RemedyDetail): Remedy | null {
  const { base } = useNav();
  const known = hasRemedy(code);
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity, enabled: known });
  if (!known) return null;
  return remedy(code, { base, balance: (meta.data?.balance ?? null) as CoreBalance | null, detail: detail ?? {}, now: Date.now() });
}

/** Klappzustand eines Hinweises, damit auch ein grauer Knopf ihn öffnen kann. */
export function useWhatHelps(): [boolean, (v: boolean) => void] {
  return useState(false);
}

/** Knopf „Was hilft?“ im Stil der leisen Nebenaktionen. */
export function WhatHelpsToggle({ open, onToggle, className = "" }: { open: boolean; onToggle: () => void; className?: string }) {
  return (
    <SmallButton expanded={open} onClick={onToggle} className={`h-8 min-h-8 px-2 ${className}`}>
      Was hilft? <span aria-hidden className="ml-1 normal-case">{open ? "▴" : "▾"}</span>
    </SmallButton>
  );
}

/** Hinweis und Sprungknöpfe; onGo schließt z. B. die Aufklappung vor dem Sprung. */
export function RemedyPanel({ remedy: r, onGo }: { remedy: Remedy; onGo?: () => void }) {
  const nav = useNav();
  const actions = r.actions ?? [];
  return (
    <div className="mt-1.5 rounded-lg border border-rule bg-card p-2.5 text-sm text-ink normal-case tracking-normal font-sans text-left" data-remedy>
      <p className="break-words">{r.hint}</p>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {actions.map((a) => (
            <SmallButton key={`${a.label}:${JSON.stringify(a.go)}`} className="max-w-full leading-tight text-center" onClick={() => { onGo?.(); nav.go(a.go); }}>
              {a.label}
            </SmallButton>
          ))}
        </div>
      )}
    </div>
  );
}

/** Nur „Was hilft?“ mit Aufklappung (wenn der Grund schon anders dasteht). */
export function WhatHelps({ code, detail, className = "mt-1" }: { code: string; detail?: RemedyDetail; className?: string }) {
  const r = useRemedy(code, detail);
  const [open, setOpen] = useState(false);
  if (!r) return null;
  return (
    <div className={className}>
      <WhatHelpsToggle open={open} onToggle={() => setOpen(!open)} />
      {open && <RemedyPanel remedy={r} onGo={() => setOpen(false)} />}
    </div>
  );
}

/**
 * Ablehnungsgrund mit „Was hilft?“ (Vorschau, Blätter, Listen). text ersetzt den Standardtext des Codes;
 * open/onOpenChange erlauben, den Hinweis von außen (grauer Knopf) aufzuklappen.
 */
export function ReasonLine({ code, text, detail, className = "text-sm text-siegel", open: openProp, onOpenChange, role }: {
  code: string | null | undefined; text?: string | null; detail?: RemedyDetail; className?: string;
  open?: boolean; onOpenChange?: (v: boolean) => void; role?: "alert";
}) {
  const r = useRemedy(code, detail);
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = onOpenChange ?? setOwn;
  const shown = text ?? (code ? errorText(code) : null);
  if (!shown) return null;
  return (
    <div className={className} role={role}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words">{shown}</span>
        {r && <WhatHelpsToggle open={open} onToggle={() => setOpen(!open)} />}
      </div>
      {r && open && <RemedyPanel remedy={r} onGo={() => setOpen(false)} />}
    </div>
  );
}

/**
 * Kurzgrund in einer Aktionsleiste (eine Zeile): antippbar, wenn es einen Hinweis gibt; der Hinweis selbst
 * erscheint über der Leiste (ActionRemedy).
 */
export function ReasonInline({ code, text, open, onToggle }: { code: string; text?: string; open: boolean; onToggle: () => void }) {
  const known = hasRemedy(code);
  const shown = text ?? errorText(code);
  if (!known) return <div className="text-xs text-siegel truncate">{shown}</div>;
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="block w-full text-left text-xs text-siegel truncate">
      {shown} <span className="text-ink2 font-display uppercase tracking-[0.1em] text-[10.5px]">· Was hilft? {open ? "▴" : "▾"}</span>
    </button>
  );
}

/** Aufgeklappter Hinweis in einer Aktionsleiste (über der Knopfzeile, begrenzte Höhe). */
export function ActionRemedy({ code, detail, open, onClose }: { code: string | null | undefined; detail?: RemedyDetail; open: boolean; onClose: () => void }) {
  const r = useRemedy(code, detail);
  if (!r || !open) return null;
  return <div className="max-h-[40vh] overflow-y-auto mb-2"><RemedyPanel remedy={r} onGo={onClose} /></div>;
}
