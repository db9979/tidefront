// Versionsanzeige und Änderungsprotokoll („Was ist neu?“) aus CHANGELOG.md.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import changelogRaw from "../../../../CHANGELOG.md?raw";
import { trpc } from "../lib/trpc.ts";
import { Badge, Button, Sheet } from "../ui.tsx";

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

export const RELEASES = parseChangelog(changelogRaw);

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
  return (
    <Sheet open={open} onClose={onClose} title="Was ist neu?">
      <p className="text-xs text-slate-400 mono mb-3">Diese App: Version {APP_VERSION} · Stand {fmtBuild(BUILD_TIME)}</p>
      <ReleaseList releases={RELEASES} highlightAfter={highlightAfter} />
    </Sheet>
  );
}

const seenKey = (playerId: number) => `tf-seen-version:${playerId}`;

/**
 * Nach einem Update einmal je Spieler „Neu in Version …“ zeigen; außerdem ein Banner, wenn auf dem
 * Server schon eine neuere Fassung läuft als die geladene App (dann neu laden). paused: solange die
 * Begrüßung offen ist, wartet „Neu in Version“ (nie beides gleichzeitig).
 */
export function UpdateNotices({ playerId, paused = false }: { playerId: number; paused?: boolean }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), refetchInterval: 5 * 60000 });
  const [seen, setSeen] = useState<string | null>(() => localStorage.getItem(seenKey(playerId)));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const s = localStorage.getItem(seenKey(playerId));
    setSeen(s);
    // Neuer Spieler auf diesem Gerät: nichts zeigen, nur merken (die Begrüßung erklärt das Spiel).
    if (s === null) {
      localStorage.setItem(seenKey(playerId), APP_VERSION);
      setSeen(APP_VERSION);
    } else if (compareVersions(APP_VERSION, s) > 0) {
      setOpen(true);
    }
  }, [playerId]);

  const close = () => {
    localStorage.setItem(seenKey(playerId), APP_VERSION);
    setOpen(false);
    setSeen(APP_VERSION);
  };
  const newer = RELEASES.filter((r) => seen && compareVersions(r.version, seen) > 0 && compareVersions(r.version, APP_VERSION) <= 0);
  const serverVersion = meta.data?.version;
  const outdated = !!serverVersion && compareVersions(serverVersion, APP_VERSION) > 0;

  return (
    <>
      {outdated && (
        <div className="fixed left-2 right-2 z-40 panel rounded-xl p-3 flex items-center gap-3" style={{ bottom: "calc(70px + env(safe-area-inset-bottom))" }} role="status">
          <span className="text-sm flex-1">Version {serverVersion} ist online. Du nutzt noch {APP_VERSION}.</span>
          <Button onClick={() => void reloadApp()}>Neu laden</Button>
        </div>
      )}
      <Sheet open={open && !paused && newer.length > 0} onClose={close} title={`Neu in Version ${APP_VERSION}`}>
        <ReleaseList releases={newer} />
        <Button className="w-full mt-4" onClick={close}>Verstanden</Button>
      </Sheet>
    </>
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
