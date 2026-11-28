// Push bündeln und Ruhezeit (AN-07, Abschlussprüfung 0.38). Vorher ~45 Pushes je Tag (Bau, Ausbildung, Bauschlange
// leer …) ohne Ruhezeit. Jetzt:
//  - Dringendes (Angriff, Allianz-Ops, Test) geht immer sofort.
//  - Ruhezeit = die eigene, in den Einstellungen gewählte Ruhezeit (Vorgabe 23–7 Uhr Spielzeitzone, abschaltbar,
//    push-quiet.ts) und zusätzlich ein laufendes Nachtschild-Fenster des Heimathafens: alles andere wird gesammelt
//    und nach dem Ende der Ruhezeit als ein Push zugestellt.
//  - Routinemeldungen (BUNDLE_PUSH_KINDS) werden auch tagsüber gesammelt: höchstens ein Push je PUSH_BUNDLE_MS.
// Ablage ohne Schemaänderung in mail_digest mit kind "push:<art>" (die Mail-Bündelung überspringt diese Zeilen).
import { and, eq, isNull, like, sql } from "drizzle-orm";
import { nightShieldWindow, type ProtectionState } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, type Engine, type NoticeKind } from "./context.ts";
import { getQuietHours, quietEndMs } from "./push-quiet.ts";

export const PUSH_BUNDLE_MS = 15 * 60_000;
/** Immer sofort, auch in der Ruhezeit. */
export const URGENT_PUSH_KINDS: readonly NoticeKind[] = ["attack", "ops", "test", "reminder"]; // reminder: selbst gestellte Zeit (Nutzerentscheid)
/** Routine: gesammelt, höchstens ein Push je PUSH_BUNDLE_MS. */
export const BUNDLE_PUSH_KINDS: readonly NoticeKind[] = ["build", "training", "fleet", "delivery", "idle", "market", "storage", "overtaken"];
const PREFIX = "push:";

/** Ende der laufenden Ruhezeit oder null: eigene Ruhezeit und Nachtschild-Fenster des Heimathafens, das spätere Ende. */
export async function pushQuietUntil(db: DbOrTx, playerId: number, nowMs: number): Promise<number | null> {
  const own = quietEndMs(await getQuietHours(db, playerId), nowMs);
  const [home] = await db.select({ state: tables.base.state }).from(tables.base)
    .where(and(eq(tables.base.playerId, playerId), eq(tables.base.isHome, true))).limit(1);
  const p = (home?.state as { protection?: ProtectionState } | undefined)?.protection;
  const w = p ? nightShieldWindow(p, nowMs, balance) : null;
  const shield = w && nowMs >= w.startMs && nowMs < w.endMs ? w.endMs : null;
  if (own === null) return shield;
  return shield === null ? own : Math.max(own, shield);
}

/** Sofort senden oder sammeln? Gesammelte Meldungen landen in der Ablage (Rückgabe "queued"). */
export async function routePush(engine: Engine, playerId: number, msg: { kind: NoticeKind; title: string; body: string }, nowMs: number): Promise<"now" | "queued"> {
  if (URGENT_PUSH_KINDS.includes(msg.kind)) return "now";
  const quiet = (await pushQuietUntil(engine.db, playerId, nowMs)) !== null;
  if (!quiet && !BUNDLE_PUSH_KINDS.includes(msg.kind)) return "now";
  await engine.db.insert(tables.mailDigest).values({ playerId, kind: `${PREFIX}${msg.kind}`, title: msg.title, body: msg.body, createdAt: new Date(nowMs) });
  return "queued";
}

export interface BundleItem { kind: NoticeKind; title: string; body: string }

/** Ein Push aus mehreren Meldungen (rein): eine Meldung bleibt wie sie ist, sonst Titel je Art mit Anzahl. */
export function bundlePayload(items: readonly BundleItem[]): { kind: NoticeKind; title: string; body: string; kinds: NoticeKind[] } {
  const kinds = [...new Set(items.map((i) => i.kind))];
  if (items.length === 1) return { ...items[0], kinds };
  const byTitle = new Map<string, number>();
  for (const i of items) byTitle.set(i.title, (byTitle.get(i.title) ?? 0) + 1);
  const parts = [...byTitle].map(([t, n]) => (n > 1 ? `${t} (${n}×)` : t));
  return { kind: items[0].kind, title: `${items.length} Meldungen`, body: parts.join(" · ").slice(0, 300), kinds };
}

/**
 * Worker, jede Minute: gesammelte Pushes zustellen – je Spieler, sobald die älteste Meldung PUSH_BUNDLE_MS alt ist und
 * keine Ruhezeit läuft. Die Zeilen werden vor dem Versand markiert (kein Doppelversand bei zwei Workern).
 */
export async function flushPushBundles(engine: Engine, nowMs: number, send: (playerId: number, p: ReturnType<typeof bundlePayload>) => Promise<number>): Promise<number> {
  const t = tables.mailDigest;
  const due = await engine.db.select({ playerId: t.playerId, oldest: sql<string>`min(${t.createdAt})` }).from(t)
    .where(and(isNull(t.sentAt), like(t.kind, `${PREFIX}%`))).groupBy(t.playerId);
  let sent = 0;
  for (const d of due) {
    if (new Date(d.oldest).getTime() > nowMs - PUSH_BUNDLE_MS) continue;
    if ((await pushQuietUntil(engine.db, d.playerId, nowMs)) !== null) continue;
    const rows = await engine.db.update(t).set({ sentAt: new Date(nowMs) })
      .where(and(eq(t.playerId, d.playerId), isNull(t.sentAt), like(t.kind, `${PREFIX}%`)))
      .returning({ id: t.id, kind: t.kind, title: t.title, body: t.body });
    if (rows.length === 0) continue;
    rows.sort((a, b) => a.id - b.id);
    const items = rows.map((r) => ({ kind: r.kind.slice(PREFIX.length) as NoticeKind, title: r.title, body: r.body }));
    try {
      sent += await send(d.playerId, bundlePayload(items));
    } catch (err) {
      engine.log("push bundle failed", { playerId: d.playerId, err: String(err) });
    }
  }
  return sent;
}

/** Offene gesammelte Pushes eines Spielers (Tests, Verwaltung). */
export async function queuedPushes(db: DbOrTx, playerId: number): Promise<BundleItem[]> {
  const t = tables.mailDigest;
  const rows = await db.select().from(t).where(and(eq(t.playerId, playerId), isNull(t.sentAt), like(t.kind, `${PREFIX}%`))).orderBy(t.id);
  return rows.map((r) => ({ kind: r.kind.slice(PREFIX.length) as NoticeKind, title: r.title, body: r.body }));
}

