// Saisonfinale „Leviathan“ (REGELN.md, Abschnitt Saisonfinale), gemeinsame Teile der Engine: Teilnehmer und Bezug K,
// Sammelpunkt und Vorhuten, Schaden gutschreiben (je Spieler und je Allianz), Abschluss (Ruhmeshalle, Erfolg
// „Armada-Jäger“, Nachrichten) und Lesemodelle. Ablauf: finale-run.ts, Kämpfe: finale-battle.ts.
import { and, eq, inArray } from "drizzle-orm";
import {
  activeUnits,
  damageSharePct,
  finaleBalance,
  finaleWarHp,
  forceHp,
  isBeginnerProtected,
  sectionHp,
  type BaseState,
  type Counts,
  type ResourceMap,
} from "@tidefront/game-core";
import { COLS, ROWS, hexDistanceKm, isOpenWater, terrainAt } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, type NoticeJob } from "./context.ts";
import { recordAchievement } from "./achievements.ts";
import { seaBfs } from "./world-events-spawn.ts";
import { addRes, endWorldEvent, notice, playersWithBase, systemMessage, type FinaleData, type Hex, type WorldEventRow } from "./world-events.ts";

const HOUR_MS = 3600000;
const fb = () => finaleBalance(balance)!;
const fmt = (n: number) => Math.round(n).toLocaleString("de-DE");

export interface FinaleParticipant extends Hex {
  baseId: number;
  playerId: number;
  name: string;
  /** Bezug K: Lebenspunkte der Kriegsschiffe und Flugzeuge, daheim und unterwegs. */
  k: number;
  bot: boolean;
}

/**
 * Teilnehmer (Bezug der Stärke): Häfen von Spielern ohne Anfängerschutz, die in den letzten activeHours aktiv waren
 * (zuletzt gesehen bzw. angemeldet); KI-Spieler zählen immer.
 */
export async function finaleParticipants(db: DbOrTx, nowMs: number): Promise<FinaleParticipant[]> {
  const rows = await db
    .select({
      baseId: tables.base.id, playerId: tables.base.playerId, name: tables.base.name, col: tables.base.col, row: tables.base.row, state: tables.base.state,
      bot: tables.player.botProfile, seen: tables.player.lastSeenAt, created: tables.player.createdAt,
    })
    .from(tables.base)
    .innerJoin(tables.player, eq(tables.player.id, tables.base.playerId));
  const missions = await db
    .select({ baseId: tables.mission.baseId, status: tables.mission.status, plan: tables.mission.plan, returning: tables.mission.returning })
    .from(tables.mission)
    .where(inArray(tables.mission.status, ["outbound", "returning", "staged", "stationed"]));
  const away = new Map<number, number>();
  for (const m of missions) {
    if (m.baseId === null) continue;
    const units = (m.status === "returning" || m.status === "stationed" ? m.returning : (m.plan as { units?: Counts }).units) as Counts | null;
    away.set(m.baseId, (away.get(m.baseId) ?? 0) + finaleWarHp(units ?? {}, balance));
  }
  const since = nowMs - fb().activeHours * HOUR_MS;
  return rows
    .filter((r) => {
      const seen = Math.max(r.seen?.getTime() ?? 0, r.created.getTime());
      return (r.bot !== null || seen >= since) && !isBeginnerProtected((r.state as BaseState).protection, nowMs, balance);
    })
    .map((r) => ({
      baseId: r.baseId, playerId: r.playerId, name: r.name, col: r.col, row: r.row, bot: r.bot !== null,
      k: finaleWarHp((r.state as BaseState).units ?? {}, balance) + (away.get(r.baseId) ?? 0),
    }));
}

/** Sammelpunkt: Seefeld (offenes Wasser) mit der kleinsten größten Entfernung zu allen Häfen. */
export function finaleCenter(ports: Hex[]): Hex | null {
  if (ports.length === 0) return null;
  let best: Hex | null = null;
  let bestD = Infinity;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (terrainAt(col, row) !== "sea" || !isOpenWater(col, row)) continue;
      let worst = 0;
      for (const p of ports) {
        worst = Math.max(worst, hexDistanceKm(p, { col, row }));
        if (worst >= bestD) break;
      }
      if (worst < bestD) { bestD = worst; best = { col, row }; }
    }
  }
  return best;
}

/**
 * Vorhuten: liegen zwei Häfen weiter als vanguardSpreadKm auseinander, bekommt jeder Hafen, der weiter als vanguardKm vom
 * Sammelpunkt liegt, eine Vorhut auf einem Seefeld höchstens vanguardKm vor sich (Richtung Sammelpunkt). Vorhuten sind
 * nur weitere Kampforte der gemeinsamen Geschwader; das Flaggschiff liegt immer am Sammelpunkt.
 */
export function finaleVanguards(center: Hex, ports: (Hex & { name: string })[]): (Hex & { name: string })[] {
  const f = fb();
  let spread = 0;
  for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) spread = Math.max(spread, hexDistanceKm(ports[i], ports[j]));
  if (spread <= f.vanguardSpreadKm) return [];
  const out: (Hex & { name: string })[] = [];
  const far = ports.filter((p) => hexDistanceKm(p, center) > f.vanguardKm).sort((a, b) => hexDistanceKm(b, center) - hexDistanceKm(a, center));
  for (const p of far) {
    if (out.some((v) => hexDistanceKm(v, p) <= f.vanguardKm)) continue; // eine Vorhut deckt mehrere nahe Häfen
    let best: Hex | null = null;
    for (const v of seaBfs(p, Math.ceil(f.vanguardKm / 100) + 1).values()) {
      if (hexDistanceKm(p, v.hex) > f.vanguardKm) continue;
      if (!best || hexDistanceKm(v.hex, center) < hexDistanceKm(best, center)) best = v.hex;
    }
    if (best && hexDistanceKm(best, center) > 150) out.push({ ...best, name: `Vorhut vor ${p.name}` });
  }
  return out;
}

/** Leere Finale-Daten. */
export function emptyFinaleData(participants: number, vanguards: FinaleData["vanguards"]): FinaleData {
  return { totalHp: 0, participants, vanguards, allianceHp: {} };
}

/**
 * Schaden gutschreiben: world_event_damage je Spieler (Schaden, Beute, Angriffe) und je Allianz nur für Menschen, mit der
 * Mitgliedschaft zum Kampfzeitpunkt. Liefert die neuen Ereignisdaten (Aufrufer schreibt units und data zusammen).
 */
export async function creditFinale(tx: Tx, ev: WorldEventRow, entries: { playerId: number; hp: number; loot: ResourceMap }[]): Promise<WorldEventRow["data"]> {
  const ids = entries.map((e) => e.playerId);
  const who = ids.length === 0 ? [] : await tx
    .select({ id: tables.player.id, bot: tables.player.botProfile, allianceId: tables.allianceMember.allianceId, name: tables.alliance.name, tag: tables.alliance.tag })
    .from(tables.player)
    .leftJoin(tables.allianceMember, eq(tables.allianceMember.playerId, tables.player.id))
    .leftJoin(tables.alliance, eq(tables.alliance.id, tables.allianceMember.allianceId))
    .where(inArray(tables.player.id, ids));
  const fd: FinaleData = { ...(ev.data.finale ?? emptyFinaleData(0, [])) };
  const allianceHp = { ...fd.allianceHp };
  for (const e of entries) {
    const hp = Math.round(e.hp);
    const where = and(eq(tables.worldEventDamage.eventId, ev.id), eq(tables.worldEventDamage.playerId, e.playerId));
    const [mine] = await tx.select().from(tables.worldEventDamage).where(where).for("update");
    if (!mine) await tx.insert(tables.worldEventDamage).values({ eventId: ev.id, playerId: e.playerId, hp, loot: e.loot, attacks: 1 });
    else await tx.update(tables.worldEventDamage).set({ hp: mine.hp + hp, loot: addRes(mine.loot as ResourceMap, e.loot), attacks: mine.attacks + 1 }).where(where);
    const p = who.find((w) => w.id === e.playerId);
    if (p && p.bot === null && p.allianceId !== null && hp > 0) {
      const k = String(p.allianceId);
      allianceHp[k] = { name: p.name ?? "?", tag: p.tag ?? "?", hp: (allianceHp[k]?.hp ?? 0) + hp };
    }
  }
  return { ...ev.data, finale: { ...fd, allianceHp } };
}

export interface FinaleResultPlayer { playerId: number; name: string; hp: number; share: number }
export interface FinaleResultAlliance { name: string; tag: string; hp: number }

/**
 * Abschluss: Ereignis beenden (defeated = versenkt, escaped = entkommen, Restbeute verfällt), Ruhmeshalle-Eintrag
 * (nur Menschen; Titel „Bezwinger des Leviathan“ und „Leviathan-Flotte“), Erfolg „Armada-Jäger“ (Anteil am
 * Gesamtschaden), Systemnachricht und Push an alle.
 */
export async function closeFinale(tx: Tx, ev: WorldEventRow, outcome: "defeated" | "escaped", due: number, winner: number | null = null): Promise<NoticeJob[]> {
  await endWorldEvent(tx, ev, outcome, due, winner, { endsAt: new Date(due), data: ev.data, units: ev.units });
  const rows = await tx
    .select({ playerId: tables.worldEventDamage.playerId, hp: tables.worldEventDamage.hp, name: tables.player.name, bot: tables.player.botProfile })
    .from(tables.worldEventDamage)
    .innerJoin(tables.player, eq(tables.player.id, tables.worldEventDamage.playerId))
    .where(eq(tables.worldEventDamage.eventId, ev.id));
  const destroyed = rows.reduce((s, r) => s + Math.max(0, r.hp), 0);
  const players: FinaleResultPlayer[] = rows
    .filter((r) => r.bot === null && r.hp > 0)
    .sort((a, b) => b.hp - a.hp || a.name.localeCompare(b.name, "de"))
    .map((r) => ({ playerId: r.playerId, name: r.name, hp: r.hp, share: damageSharePct(r.hp, destroyed) }));
  const alliances: FinaleResultAlliance[] = Object.values(ev.data.finale?.allianceHp ?? {}).filter((a) => a.hp > 0).sort((a, b) => b.hp - a.hp);
  const champion = players[0] ?? null;
  const fleet = alliances[0] ?? null;
  const totalHp = ev.data.finale?.totalHp ?? ev.data.initialHp;
  if (ev.seasonId !== null) {
    await tx.insert(tables.seasonFinaleResult).values({
      seasonId: ev.seasonId, outcome: outcome === "defeated" ? "sunk" : "escaped", endedAt: new Date(due), totalHp: Math.round(totalHp), destroyedHp: destroyed,
      players, alliances, championPlayerId: champion?.playerId ?? null, championName: champion?.name ?? null, fleetName: fleet?.name ?? null, fleetTag: fleet?.tag ?? null,
    }).onConflictDoNothing();
  }
  for (const p of players) await recordAchievement(tx, p.playerId, "armada", p.share, { atMs: due, mode: "max", weekly: false });
  const head = outcome === "defeated"
    ? `Der Leviathan ist versenkt! Die Kartell-Armada ist geschlagen.`
    : `Die Kartell-Armada ist entkommen. Der Leviathan zieht ab, die Restbeute verfällt.`;
  const lines = [head, `Vernichtet: ${fmt(destroyed)} von ${fmt(ev.data.initialHp)} Lebenspunkten.`];
  if (champion) lines.push(`Bezwinger des Leviathan: ${champion.name} (${fmt(champion.hp)} LP, ${champion.share} %).`);
  if (fleet) lines.push(`Leviathan-Flotte: [${fleet.tag}] ${fleet.name} (${fmt(fleet.hp)} LP).`);
  if (players.length > 1) lines.push(`Rangliste: ${players.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} ${fmt(p.hp)} LP`).join(", ")}.`);
  lines.push("Das Ergebnis steht nach dem Saisonende in der Ruhmeshalle.");
  const all = await playersWithBase(tx);
  const subject = outcome === "defeated" ? "Saisonfinale: Leviathan versenkt" : "Saisonfinale: Armada entkommen";
  await systemMessage(tx, all.map((p) => p.playerId), subject, lines.join("\n"), due);
  return [...new Set(all.map((p) => p.playerId))].map((id) => notice(id, "fleet", subject, head));
}

// ---------------------------------------------------------------- Lesemodelle

/** Zusatz im Lesemodell der Weltereignisse (Karte, Info-Blatt, Banner). */
export function finaleView(ev: WorldEventRow) {
  const units = activeUnits(ev.units as Counts);
  const initial = ev.initialUnits as Counts;
  const fd = ev.data.finale;
  return {
    totalHp: fd?.totalHp ?? 0,
    remainingHp: forceHp(units, balance),
    initialHp: ev.data.initialHp,
    participants: fd?.participants ?? 0,
    vanguards: fd?.vanguards ?? [],
    boats: units.schnellboot ?? 0,
    initialBoats: initial.schnellboot ?? 0,
    sections: units.flaggschiff ?? 0,
    initialSections: initial.flaggschiff ?? 0,
    sectionHp: sectionHp(balance),
    flagshipOpen: ev.status === "active" && (units.schnellboot ?? 0) <= 0,
    alliances: Object.values(fd?.allianceHp ?? {}).sort((a, b) => b.hp - a.hp).slice(0, 5),
  };
}

/** Ruhmeshalle: Finale-Ergebnisse je Saison; own = eigener Eintrag (Platz, Schaden, Anteil). */
export async function finaleResultsFor(db: DbOrTx, seasonIds: number[], playerId: number) {
  const out = new Map<number, {
    outcome: string; endedAtMs: number; totalHp: number; destroyedHp: number; champion: string | null; fleet: { name: string; tag: string } | null;
    top: FinaleResultPlayer[]; alliances: FinaleResultAlliance[]; own: (FinaleResultPlayer & { rank: number }) | null;
  }>();
  if (seasonIds.length === 0) return out;
  const rows = await db.select().from(tables.seasonFinaleResult).where(inArray(tables.seasonFinaleResult.seasonId, seasonIds));
  for (const r of rows) {
    const players = r.players as FinaleResultPlayer[];
    const i = players.findIndex((p) => p.playerId === playerId);
    out.set(r.seasonId, {
      outcome: r.outcome, endedAtMs: r.endedAt.getTime(), totalHp: r.totalHp, destroyedHp: r.destroyedHp, champion: r.championName,
      fleet: r.fleetName ? { name: r.fleetName, tag: r.fleetTag ?? "" } : null,
      top: players.slice(0, 3), alliances: (r.alliances as FinaleResultAlliance[]).slice(0, 3), own: i >= 0 ? { ...players[i], rank: i + 1 } : null,
    });
  }
  return out;
}
