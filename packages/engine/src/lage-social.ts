// Lagezentrum, Ergänzung aus der Abschlussprüfung 0.38:
//  - TST-15: Beitrittsanfragen (Führung/Offiziere) und Einladungen (an den Spieler) unter „Wartet auf dich“;
//  - TX-08: „Anfängerschutz endet“ in den letzten 24 h als dringender Termin;
//  - TST-16: Belohnungen nach Quelle gezählt, im Text nur Quellen mit Anzahl;
//  - UX-0.43 C3 (soziale Zeilen): ohne Allianz und ohne Einladung ein ruhiger Hinweis „Noch ohne Allianz“ (nicht dringend).
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { isBeginnerProtected } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import type { BaseRow } from "./store.ts";
import { minutesText } from "./names.ts";
import { HOUR_MS, row, type LageRow } from "./lage-types.ts";

const DAY_MS = 24 * HOUR_MS;
/** „Anfängerschutz endet“ ab so lange vor dem Ende. */
export const BEGINNER_WARN_MS = DAY_MS;

/** Abholbare Belohnungen je Quelle. daily/guide: Tagesbefehle und Auftragsbuch (für „Alle abholen“ und den Text). */
export interface RewardSources { achievements: number; weekly: number; daily: number; guide: number }

/** „10 im Auftragsbuch, 2 Erfolge“ – nur Quellen mit Anzahl (rein). */
export function rewardSourcesText(s: RewardSources): string {
  const parts: string[] = [];
  if (s.guide > 0) parts.push(`${s.guide} im Auftragsbuch`);
  if (s.daily > 0) parts.push(`${s.daily} ${s.daily === 1 ? "Tagesbefehl" : "Tagesbefehle"}`);
  if (s.weekly > 0) parts.push(`${s.weekly} ${s.weekly === 1 ? "Wochenziel" : "Wochenziele"}`);
  if (s.achievements > 0) parts.push(`${s.achievements} ${s.achievements === 1 ? "Erfolg" : "Erfolge"}`);
  return parts.join(", ");
}

/** Abholbare Erfolgsstufen und erfüllte Wochenziele (reine Zählung, ohne Neuberechnung der Zähler). */
export async function rewardSourceCounts(db: DbOrTx, playerId: number): Promise<Pick<RewardSources, "achievements" | "weekly">> {
  const at = tables.achievementTier;
  const wg = tables.weeklyGoal;
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(at).where(and(eq(at.playerId, playerId), isNull(at.claimedAt)));
  const [w] = await db.select({ n: sql<number>`count(*)::int` }).from(wg).where(and(eq(wg.playerId, playerId), isNotNull(wg.completedAt), isNull(wg.claimedAt)));
  return { achievements: a?.n ?? 0, weekly: w?.n ?? 0 };
}

/** Beitrittsanfragen an die eigene Allianz (nur Führung/Offiziere) und Einladungen an den Spieler. */
export async function allianceRows(db: DbOrTx, playerId: number): Promise<LageRow[]> {
  const r = tables.allianceRequest;
  const [m] = await db.select({ allianceId: tables.allianceMember.allianceId, role: tables.allianceMember.role }).from(tables.allianceMember)
    .where(eq(tables.allianceMember.playerId, playerId));
  const out: LageRow[] = [];
  if (m && (m.role === "fuehrung" || m.role === "offizier")) {
    const reqs = await db.select({ id: r.id, name: tables.player.name }).from(r).innerJoin(tables.player, eq(tables.player.id, r.playerId))
      .where(and(eq(r.allianceId, m.allianceId), eq(r.kind, "anfrage"))).orderBy(desc(r.id)).limit(20);
    if (reqs.length > 0) {
      const names = reqs.slice(0, 3).map((x) => x.name).join(", ") + (reqs.length > 3 ? " …" : "");
      out.push(row({
        key: `beitritt:${reqs[0].id}:${reqs.length}`, kind: "beitritt", icon: "sammelangriff", urgent: true,
        text: reqs.length === 1 ? "1 Beitrittsanfrage" : `${reqs.length} Beitrittsanfragen`, sub: names, jump: { to: "alliance" },
      }));
    }
  }
  if (!m) {
    const inv = await db.select({ id: r.id, tag: tables.alliance.tag, name: tables.alliance.name }).from(r)
      .innerJoin(tables.alliance, eq(tables.alliance.id, r.allianceId))
      .where(and(eq(r.playerId, playerId), eq(r.kind, "einladung"))).orderBy(desc(r.id)).limit(5);
    for (const i of inv) {
      out.push(row({ key: `einladung:${i.id}`, kind: "einladung", icon: "sammelangriff", text: `Einladung in die Allianz [${i.tag}] ${i.name}`, jump: { to: "alliance" } }));
    }
    if (inv.length === 0) {
      const [asked] = await db.select({ id: r.id }).from(r).where(and(eq(r.playerId, playerId), eq(r.kind, "anfrage"))).limit(1);
      const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(tables.alliance);
      const n = a?.n ?? 0;
      out.push(row({
        key: "ohne-allianz", kind: "allianz-hinweis", icon: "sammelangriff",
        text: asked ? "Beitrittsanfrage gestellt – wartet auf Antwort" : n > 0 ? `Noch ohne Allianz – ${n === 1 ? "1 Allianz" : `${n} Allianzen`} in der Runde` : "Noch ohne Allianz – gründe die erste",
        sub: "Verbündete überfallen sich nicht und teilen Chat, Sammelangriffe und Seekabel", jump: { to: "alliance" },
      }));
    }
  }
  return out;
}

/** Ende des Anfängerschutzes (Heimathafen) innerhalb von BEGINNER_WARN_MS: Termin mit Ton „alarm“. */
export function beginnerRow(bases: BaseRow[], nowMs: number): LageRow | null {
  const home = bases.find((b) => b.isHome) ?? bases[0];
  if (!home) return null;
  const p = home.state.protection;
  if (!isBeginnerProtected(p, nowMs, balance)) return null;
  const end = p.createdAtMs + balance.protection.beginnerDays * DAY_MS;
  if (end - nowMs > BEGINNER_WARN_MS) return null;
  return row({
    key: `anfaengerschutz:${end}`, kind: "anfaengerschutz", atMs: end, icon: "schild", tone: "alarm", urgent: true,
    text: `Anfängerschutz endet in ${minutesText(end - nowMs)}`,
    sub: "Danach können dich Spieler überfallen – Abwehr, Bunker und Nachtschild prüfen",
    jump: { to: "base", baseId: home.id },
  });
}

