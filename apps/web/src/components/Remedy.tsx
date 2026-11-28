// „Was hilft?“ unter Sperr- und Fehlermeldungen: aufklappbarer Hinweis mit Sprungknöpfen (lib/remedies, lib/nav).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Balance as CoreBalance } from "@tidefront/game-core";
import { trpc } from "../lib/trpc.ts";
import { useNav } from "../lib/nav.ts";
import { REMEDIES, remedy, type Remedy, type RemedyDetail } from "../lib/remedies/index.ts";
import { Bar, SmallButton } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import { errorText, fmtNum } from "../lib/names.ts";
import type { NavTarget } from "../lib/remedies/types.ts";
import { useNow } from "../lib/time.ts";
import { liveBaseAt } from "../lib/live-base.ts";

/** Gibt es zu diesem Code überhaupt einen Hinweis? */
export function hasRemedy(code: string | null | undefined): boolean {
  return !!code && Object.hasOwn(REMEDIES, code);
}

/**
 * Abhilfe zum Code mit aktivem Hafen und Balance (null: nichts zu tun). Live: Bestände werden sekündlich
 * hochgerechnet, Fehlmengen und Wartezeiten passen sich ohne Neuöffnen an.
 */
export function useRemedy(code: string | null | undefined, detail?: RemedyDetail): Remedy | null {
  const { base } = useNav();
  const known = hasRemedy(code);
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity, enabled: known });
  const now = useNow();
  if (!known) return null;
  return remedy(code, { base: liveBaseAt(base, now), balance: (meta.data?.balance ?? null) as CoreBalance | null, detail: detail ?? {}, now });
}

/** Klappzustand eines Hinweises, damit auch ein grauer Knopf ihn öffnen kann. */
export function useWhatHelps(): [boolean, (v: boolean) => void] {
  return useState(false);
}

/** Knopf „Was hilft?“ im Stil der leisen Nebenaktionen (volle 44-px-Tippfläche). */
export function WhatHelpsToggle({ open, onToggle, className = "" }: { open: boolean; onToggle: () => void; className?: string }) {
  return (
    <SmallButton expanded={open} onClick={onToggle} className={`px-2 ${className}`}>
      Was hilft? <span aria-hidden className="ml-1 normal-case">{open ? "▴" : "▾"}</span>
    </SmallButton>
  );
}

/** Symbol zu einem Sprungziel (Gebäude, Ressource, Bereich). */
function navIcon(go: NavTarget): string {
  switch (go.to) {
    case "building": return go.id;
    case "market": return go.resource ?? "nav-boerse";
    case "research": return "forschungsamt";
    case "troops": return "nav-truppen";
    case "map": return "nav-karte";
    case "meldungen": return "nav-bericht";
    default: return "nav-basis";
  }
}

/** Inhalt der Hinweis-Karte: Fehlmengen als Fortschrittszeilen, Erklärung, Sprungziele als Kacheln. */
export function RemedyPanel({ remedy: r, onGo, bare = false }: { remedy: Remedy; onGo?: () => void; bare?: boolean }) {
  const nav = useNav();
  // Knöpfe, die nur auf den aktuellen Bildschirm zeigen (z. B. „Zur Börse“ auf der Börse), helfen nicht.
  const actions = (r.actions ?? []).filter((a) => !nav.here?.(a.go));
  const body = (
    <div className="space-y-2.5">
      {r.items && r.items.length > 0 && (
        <ul className="space-y-2">
          {r.items.map((it) => (
            <li key={it.id} className="grid grid-cols-[22px_1fr_auto] items-center gap-x-2 gap-y-1">
              <Icon id={it.id} size={20} />
              <span className="text-sm font-medium">{it.label}</span>
              <span className="mono text-[12.5px] text-ink2"><span className="text-siegel">{fmtNum(it.have)}</span> / {fmtNum(it.need)}</span>
              <span />
              <Bar value={it.need > 0 ? it.have / it.need : 1} tone="brass" />
              <span className="text-[11px] text-ink2 whitespace-nowrap">{it.eta ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
      {r.hint && <p className="text-[13px] leading-snug text-ink2">{r.hint}</p>}
      {actions.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <button
              key={`${a.label}:${JSON.stringify(a.go)}`}
              type="button"
              onClick={() => { onGo?.(); nav.go(a.go); }}
              className={`tap btn-quiet rounded-lg px-2.5 py-2 flex items-center gap-2 text-left text-[13px] leading-tight font-medium ${actions.length === 1 ? "col-span-2" : ""}`}
            >
              <Icon id={navIcon(a.go)} size={22} className="shrink-0" />
              <span className="flex-1 min-w-0">{a.label}</span>
              <span aria-hidden className="text-ink2 text-base leading-none">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  if (bare) return body;
  return (
    <div className="mt-2 rounded-lg border border-messing/45 border-l-[3px] border-l-messing bg-[#f7efdf] p-3 text-ink normal-case tracking-normal font-sans text-left" data-remedy>
      {r.summary && <p className="text-sm font-medium mb-2">{r.summary}</p>}
      {body}
    </div>
  );
}

/**
 * Hinweis-Karte für einen Sperrgrund: Kopf mit Grund und Kurzfassung (immer sichtbar, antippbar), darunter
 * aufgeklappt Fehlmengen, Erklärung und Sprungziele. Ohne Abhilfe nur der Grund.
 */
function BlockerCard({ reason, remedy: r, open, setOpen, role }: {
  reason: string; remedy: Remedy | null; open: boolean; setOpen: (v: boolean) => void; role?: "alert";
}) {
  if (!r) return <p className="text-sm text-siegel" role={role}>{reason}</p>;
  return (
    <div className="mt-2 rounded-lg border border-messing/45 border-l-[3px] border-l-messing bg-[#f7efdf] text-ink normal-case tracking-normal font-sans text-left" role={role} data-remedy>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="tap w-full flex items-center gap-2.5 px-3 py-2 text-left">
        <span aria-hidden className="shrink-0 w-6 h-6 rounded-full border border-messing text-messing grid place-items-center font-serif text-sm leading-none">!</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium leading-snug">{reason}</span>
          {r.summary && <span className="block text-xs text-ink2 mt-0.5">{r.summary}</span>}
        </span>
        <span className="shrink-0 text-[11px] font-display uppercase tracking-[0.1em] text-messing whitespace-nowrap">{open ? "Was hilft ▴" : "Was hilft ▾"}</span>
      </button>
      {open && <div className="px-3 pb-3 pt-0.5 border-t border-messing/25"><div className="pt-2.5"><RemedyPanel remedy={r} bare onGo={() => setOpen(false)} /></div></div>}
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
  if (!r) return <div className={className} role={role}><span className="break-words">{shown}</span></div>;
  return <BlockerCard reason={shown} remedy={r} open={open} setOpen={setOpen} role={role} />;
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
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full min-w-0 items-baseline gap-1 text-left text-xs text-siegel">
      <span className="min-w-0 truncate">{shown}</span>
      <span className="shrink-0 whitespace-nowrap text-messing font-display uppercase tracking-[0.1em] text-[11px]">· Was hilft {open ? "▴" : "▾"}</span>
    </button>
  );
}

/** Aufgeklappter Hinweis in einer Aktionsleiste (über der Knopfzeile, begrenzte Höhe). */
export function ActionRemedy({ code, detail, open, onClose }: { code: string | null | undefined; detail?: RemedyDetail; open: boolean; onClose: () => void }) {
  const r = useRemedy(code, detail);
  if (!r || !open) return null;
  return <div className="max-h-[40vh] overflow-y-auto mb-2"><RemedyPanel remedy={r} onGo={onClose} /></div>;
}
