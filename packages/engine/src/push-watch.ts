// Neue Push-Arten aus dem Wartungslauf (UX-0.43 B8, Wiederkehr W-3). Beide laufen über pushToPlayer, also mit der
// Ruhezeit und dem 15-min-Bündel des bestehenden Push-Systems (push-bundle.ts: „storage“ und „overtaken“ sind
// Routinemeldungen) und dem eigenen Schalter je Art (Einstellungen → Benachrichtigungen):
//  - „Lager fast voll“ (storage): Bestand ≥ STORAGE_NEAR_FULL der Lagergrenze (wie die Lage), höchstens einmal je
//    Rohstoff und Spieltag – über alle Häfen des Spielers zusammen.
//  - „Du wurdest überholt“ (overtaken): Rang schlechter als bei der letzten Prüfung (höchstens stündlich gerechnet),
//    höchstens einmal je Spieltag; genannt wird, wer jetzt direkt davor steht und vorher dahinter lag.
// Geprüft werden nur Menschen mit Push-Abo oder bestätigter E-Mail (Nutzerentscheid: beide auch als E-Mail-Art,
// gebündelt wie Bau/Ausbildung, Vorgabe aus). Ablage ohne Schemaänderung in
// server_setting: "push_storage:<Spieler>" = {day, res}, "push_rank" = {seasonId, atMs, ranks, told}.
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { settle, storageCapacity, type BaseState } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { basesOfPlayer } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { getSetting, setSetting } from "./settings.ts";
import { dayKey } from "./challenge-pool.ts";
import { runningSeason } from "./season.ts";
import { computeStandings } from "./scoring.ts";
import { nameOf } from "./names.ts";
import { pushToPlayer } from "./push.ts";
import { mailNotice } from "./mail.ts"; // Nutzerentscheid: auch als E-Mail-Art (gebündelt)
import type { Notice } from "./context.ts";
import { STORAGE_NEAR_FULL } from "./lage-wait.ts";

/** Rangprüfung höchstens so oft (die Wertung zu rechnen kostet). */
export const RANK_CHECK_MS = 60 * 60_000;
const RANK_KEY = "push_rank";
const storageKey = (playerId: number) => `push_storage:${playerId}`;

/** Menschen mit Push-Abo oder bestätigter E-Mail-Adresse (sonst gibt es nichts zu senden). */
async function subscribedHumans(db: DbOrTx): Promise<number[]> {
  const push = await db.selectDistinct({ id: tables.pushSubscription.playerId }).from(tables.pushSubscription)
    .innerJoin(tables.player, eq(tables.player.id, tables.pushSubscription.playerId))
    .where(isNull(tables.player.botProfile));
  const mail = await db.select({ id: tables.playerEmail.playerId }).from(tables.playerEmail)
    .innerJoin(tables.player, eq(tables.player.id, tables.playerEmail.playerId))
    .where(and(isNull(tables.player.botProfile), isNotNull(tables.playerEmail.verifiedAt)));
  return [...new Set([...push, ...mail].map((r) => r.id))].sort((a, b) => a - b);
}

/** Push (Ruhezeit/Bündel) und E-Mail (gebündelt wie Bau/Ausbildung, nur mit eigenem Schalter) – Fehler nur protokolliert. */
async function notify(engine: Engine, playerId: number, n: Notice, nowMs: number): Promise<void> {
  await pushToPlayer(engine, playerId, n, { nowMs }).catch((err) => engine.log("push error", String(err)));
  await mailNotice(engine, playerId, n).catch((err) => engine.log("mail error", String(err)));
}

/** Rohstoffe mit Füllstand ≥ share der Lagergrenze und ihr Anteil (rein). */
export function nearFull(state: BaseState, cap: number, share = STORAGE_NEAR_FULL): { resource: string; pct: number }[] {
  if (!(cap > 0)) return [];
  return balance.resources
    .map((r) => ({ resource: r, pct: (state.resources[r] ?? 0) / cap }))
    .filter((x) => x.pct >= share);
}

/** Push „Lager fast voll“ für alle Abonnenten; Rückgabe: Zahl der Spieler mit neuer Meldung. */
export async function runStoragePushes(engine: Engine, nowMs: number): Promise<number> {
  const db = engine.db;
  const day = dayKey(nowMs);
  let n = 0;
  for (const playerId of await subscribedHumans(db)) {
    const raw = await getSetting(db, storageKey(playerId));
    let told: string[] = [];
    try {
      const m = raw ? (JSON.parse(raw) as { day: string; res: string[] }) : null;
      if (m && m.day === day) told = m.res;
    } catch { /* unlesbar: neu */ }
    const fresh = new Map<string, { pct: number; base: string }>();
    const bases = await basesOfPlayer(db, playerId);
    for (const b of bases) {
      const mods = await modsOf(db, b, nowMs);
      const st = settle(b.state, nowMs, balance, mods);
      for (const x of nearFull(st, storageCapacity(st, balance, mods))) {
        if (told.includes(x.resource)) continue;
        if (!fresh.has(x.resource) || fresh.get(x.resource)!.pct < x.pct) fresh.set(x.resource, { pct: x.pct, base: b.name });
      }
    }
    if (fresh.size === 0) continue;
    const parts = [...fresh].map(([r, x]) => `${nameOf(r)} ${Math.min(100, Math.round(x.pct * 100))} %${bases.length > 1 ? ` (${x.base})` : ""}`);
    await setSetting(db, storageKey(playerId), JSON.stringify({ day, res: [...told, ...fresh.keys()] }));
    await notify(engine, playerId, {
      kind: "storage", title: "Lager fast voll", body: `${parts.join(", ")} – ausgeben, verkaufen oder Lagerkomplex ausbauen.`, url: "/?tab=basis", tag: "storage",
    }, nowMs);
    n++;
  }
  return n;
}

interface RankMemo { seasonId: number; atMs: number; ranks: Record<string, number>; told: Record<string, string> }

/**
 * Wer hat einen Spieler überholt? Unter den Spielern, die jetzt vor ihm stehen und vorher hinter ihm lagen, der
 * nächste davor (rein). null, wenn sich der Spieler nicht verschlechtert hat oder kein solcher Spieler da ist.
 */
export function overtaker(playerId: number, prev: Record<string, number>, now: { playerId: number; rank: number; name: string }[]): { name: string; rank: number; total: number } | null {
  const me = now.find((r) => r.playerId === playerId);
  const was = prev[String(playerId)];
  if (!me || was === undefined || me.rank <= was) return null;
  const by = now.filter((r) => r.playerId !== playerId && r.rank < me.rank && (prev[String(r.playerId)] ?? Infinity) > was)
    .sort((a, b) => b.rank - a.rank)[0];
  return by ? { name: by.name, rank: me.rank, total: now.length } : null;
}

/** Push „Du wurdest überholt“ (höchstens stündlich gerechnet, je Spieler höchstens 1× am Tag). Rückgabe: Pushes. */
export async function runOvertakenPushes(engine: Engine, nowMs: number, opts: { force?: boolean } = {}): Promise<number> {
  const db = engine.db;
  const s = await runningSeason(db);
  if (!s) return 0;
  let memo: RankMemo | null = null;
  try {
    const raw = await getSetting(db, RANK_KEY);
    memo = raw ? (JSON.parse(raw) as RankMemo) : null;
  } catch { memo = null; }
  if (memo && memo.seasonId === s.id && !opts.force && nowMs - memo.atMs < RANK_CHECK_MS) return 0;
  const standings = await computeStandings(db, s.startsAt.getTime(), nowMs);
  const ranks = Object.fromEntries(standings.map((r) => [String(r.playerId), r.rank]));
  const told = memo?.seasonId === s.id ? { ...memo.told } : {};
  const day = dayKey(nowMs);
  let sent = 0;
  if (memo && memo.seasonId === s.id) {
    const subs = new Set(await subscribedHumans(db));
    for (const r of standings) {
      if (!subs.has(r.playerId) || told[String(r.playerId)] === day) continue;
      const o = overtaker(r.playerId, memo.ranks, standings);
      if (!o) continue;
      told[String(r.playerId)] = day;
      await notify(engine, r.playerId, {
        kind: "overtaken", title: "Du wurdest überholt", body: `${o.name} hat dich überholt – du stehst jetzt auf Platz ${o.rank} von ${o.total}.`, url: "/?tab=saison", tag: "overtaken",
      }, nowMs);
      sent++;
    }
  }
  await setSetting(db, RANK_KEY, JSON.stringify({ seasonId: s.id, atMs: nowMs, ranks, told } satisfies RankMemo));
  return sent;
}
