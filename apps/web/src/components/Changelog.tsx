// Versionsanzeige und Änderungsprotokoll („Was ist neu?“) aus CHANGELOG.md.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { Badge, Button, Sheet } from "../ui.tsx";
import { useTickerPos } from "./market/TickerBar.tsx";

export const APP_VERSION = __APP_VERSION__;
export const BUILD_TIME = __BUILD_TIME__;

export interface Release {
  version: string;
  date: string;
  items: string[];
}

/** „## 0.7.0 – 27.11.2026“ gefolgt von „- …“-Zeilen. */
export function parseChangelog(md: string): Release[] {
  const out: Release[] = [];
  for (const line of md.split("\n")) {
    const h = line.match(/^##\s+([\d.]+)\s*[–-]\s*(.+)$/);
    if (h) {
      out.push({ version: h[1], date: h[2].trim(), items: [] });
      continue;
    }
    const li = line.match(/^-\s+(.*)$/);
    if (li && out.length > 0) out[out.length - 1].items.push(li[1]);
  }
  return out;
}

/** Protokoll erst bei Bedarf laden (eigener Chunk, hält den Start schlank). */
let releasesPromise: Promise<Release[]> | null = null;
let releasesCache: Release[] | null = null;
export function loadReleases(): Promise<Release[]> {
  releasesPromise ??= import("../../../../CHANGELOG.md?raw").then((m) => (releasesCache = parseChangelog(m.default)));
  return releasesPromise;
}

/** Versionen aus CHANGELOG.md; null, solange noch geladen wird. enabled=false lädt nichts. */
export function useReleases(enabled = true): Release[] | null {
  const [list, setList] = useState<Release[] | null>(releasesCache);
  useEffect(() => {
    if (!enabled || list) return;
    let live = true;
    void loadReleases().then((r) => { if (live) setList(r); });
    return () => { live = false; };
  }, [enabled, list]);
  return list;
}

/** Vergleicht Versionen wie 0.10.0 und 0.9.2 numerisch. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** **fett** im Fließtext, sonst reiner Text. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function fmtBuild(iso: string | null | undefined): string {
  if (!iso) return "Entwicklungsstand";
  return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ReleaseList({ releases, highlightAfter }: { releases: Release[]; highlightAfter?: string | null }) {
  return (
    <div className="space-y-4">
      {releases.map((r) => {
        const isNew = highlightAfter ? compareVersions(r.version, highlightAfter) > 0 : false;
        return (
          <section key={r.version}>
            <div className="flex items-baseline gap-2 mb-1">
              <h3 className="font-serif text-lg">Version {r.version}</h3>
              <span className="text-xs text-slate-400 mono">{r.date}</span>
              {isNew && <Badge tone="red">Neu</Badge>}
            </div>
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-200">
              {r.items.map((it, i) => <li key={i}>{inline(it)}</li>)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Kurzzeile mit Version und Knopf zum Protokoll (Handbuch, Anmeldung). */
export function VersionLine({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="text-xs text-slate-400 mono flex items-center justify-center gap-2 flex-wrap py-2">
      <span>Version {APP_VERSION} · Stand {fmtBuild(BUILD_TIME)}</span>
      <button type="button" className="tap underline text-sea-300" onClick={onOpen}>Was ist neu?</button>
    </div>
  );
}

export function ChangelogSheet({ open, onClose, highlightAfter }: { open: boolean; onClose: () => void; highlightAfter?: string | null }) {
  const releases = useReleases(open);
  return (
    <Sheet open={open} onClose={onClose} title="Was ist neu?">
      <p className="text-xs text-slate-400 mono mb-3">Diese App: Version {APP_VERSION} · Stand {fmtBuild(BUILD_TIME)}</p>
      {releases ? <ReleaseList releases={releases} highlightAfter={highlightAfter} /> : <p className="text-sm text-slate-400">Wird geladen …</p>}
    </Sheet>
  );
}

const seenKey = (playerId: number) => `tf-seen-version:${playerId}`;
const versionSubs = new Set<() => void>();

/**
 * „Neu in Version …“ (UX 0.43, O-4): nicht mehr als eigenes Blatt, sondern gebündelt in der Rückkehrkarte der Lage.
 * Liefert die gesehene Version; markSeen merkt die laufende. Neuer Spieler auf diesem Gerät: gilt als gesehen.
 */
export function useVersionNotice(playerId: number | null): { unseen: string | null; seen: string | null; markSeen: () => void } {
  const [seen, setSeen] = useState<string | null>(() => (playerId === null ? null : localStorage.getItem(seenKey(playerId))));
  useEffect(() => {
    if (playerId === null) return;
    const read = () => setSeen(localStorage.getItem(seenKey(playerId)));
    if (localStorage.getItem(seenKey(playerId)) === null) localStorage.setItem(seenKey(playerId), APP_VERSION);
    read();
    versionSubs.add(read);
    return () => { versionSubs.delete(read); };
  }, [playerId]);
  const unseen = seen !== null && compareVersions(APP_VERSION, seen) > 0 ? APP_VERSION : null;
  const markSeen = () => {
    if (playerId === null) return;
    localStorage.setItem(seenKey(playerId), APP_VERSION);
    for (const f of versionSubs) f();
  };
  return { unseen, seen, markSeen };
}

/** Änderungen zwischen der gesehenen und der laufenden Version (für die Rückkehrkarte). */
export function NewReleases({ since }: { since: string | null }) {
  const releases = useReleases(since !== null);
  const newer = (releases ?? []).filter((r) => since && compareVersions(r.version, since) > 0 && compareVersions(r.version, APP_VERSION) <= 0);
  return releases ? <ReleaseList releases={newer} /> : <p className="text-sm text-slate-400">Wird geladen …</p>;
}

/**
 * Banner, wenn auf dem Server schon eine neuere Fassung läuft als die geladene App (dann neu laden). „Neu in Version“
 * zeigt seit 0.43 die Rückkehrkarte der Lage (useVersionNotice); playerId/paused bleiben für die Einbindung in App.tsx.
 */
export function UpdateNotices(_props: { playerId: number; paused?: boolean }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), refetchInterval: 5 * 60000 });
  const tickerBelow = useTickerPos() === "unten";
  const serverVersion = meta.data?.version;
  const outdated = !!serverVersion && compareVersions(serverVersion, APP_VERSION) > 0;
  if (!outdated) return null;
  return (
    <div className="fixed left-2 right-2 z-40 panel rounded-xl p-3 flex items-center gap-3" style={{ bottom: `calc(${tickerBelow ? 108 : 70}px + env(safe-area-inset-bottom))` }} role="status">
      <span className="text-sm flex-1">Version {serverVersion} ist online. Du nutzt noch {APP_VERSION}.</span>
      <Button onClick={() => void reloadApp()}>Neu laden</Button>
    </div>
  );
}

/** Service Worker aktualisieren und neu laden, damit die neue Fassung sicher geladen wird. */
async function reloadApp(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    // ohne Service Worker einfach neu laden
  }
  location.reload();
}
