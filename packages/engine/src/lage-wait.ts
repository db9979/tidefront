// Lagezentrum „Wartet auf dich“: je Hafen eine Zeile (freie Ausbildung, Missionsplätze, Lager fast voll – nur handelbar),
// Versorgungsmangel, Aufholhilfe-Gutschrift, verfallende Lagebilder lohnender Ziele, abholbare Erfolge/Wochenziele.
// Tagesbefehle und Auftragsbuch ergänzt die Oberfläche aus ihren ohnehin geladenen Abfragen (daily.get, guide.get).
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { missionSlots, settle, startTraining, storageCapacity, type Modifiers, type ResourceMap } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { ADMIRAL_RETURN_TYPE, type BaseRow } from "./store.ts";
import { catchUpView } from "./catch-up.ts";
import { fmtInt, nameOf } from "./names.ts";
import { HOUR_MS, harborSub, row, type LageRow } from "./lage-types.ts";
import { allianceRows, rewardSourceCounts, rewardSourcesText, type RewardSources } from "./lage-social.ts";

/** Lager „fast voll“ ab diesem Füllstand. */
export const STORAGE_NEAR_FULL = 0.9;
/** Lagebild „lohnend“: plünderbarer Warenwert (Bestand über dem Bunkerschutz zum Richtwert) mindestens. */
export const LOHNEND_MIN_VALUE = 3000;
/** Lagebild „verfällt bald“: wird innerhalb dieser Zeit veraltet (intel.staleHours). */
export const INTEL_EXPIRY_WARN_MS = 6 * HOUR_MS;
/** Gebäude mit eigener Ausbildung (Truppen → Ausbilden). */
const TRAINERS = ["werft", "kaserne", "flugfeld"];

/** Abholbare Erfolgsstufen und erfüllte Wochenziele (reine Zählung, ohne Neuberechnung der Zähler). */
export async function rewardCounts(db: DbOrTx, playerId: number): Promise<number> {
  const s = await rewardSourceCounts(db, playerId);
  return s.achievements + s.weekly;
}

export async function waitingRows(
  db: DbOrTx, playerId: number, bases: BaseRow[], mods: Map<number, Modifiers>, nowMs: number,
  sources: Pick<RewardSources, "achievements" | "weekly">,
): Promise<LageRow[]> {
  const out: LageRow[] = [];
  const rewards = sources.achievements + sources.weekly;
  if (rewards > 0) {
    // TST-16: nur die Quellen mit Anzahl nennen („2 Erfolge, 1 Wochenziel“).
    const what = rewardSourcesText({ ...sources, daily: 0, guide: 0 });
    out.push(row({ key: "belohnung:erfolge", kind: "belohnung", icon: "hafenmeister", tone: "gut", urgent: true,
      text: `${rewards === 1 ? "1 Belohnung" : `${rewards} Belohnungen`} abholbereit (${what})`, jump: { to: "rewards", where: "erfolge" } }));
  }
  out.push(...(await allianceRows(db, playerId))); // TST-15: Beitrittsanfragen, Einladungen
  const t = tables.mission;
  const active = await db.select({ baseId: t.baseId, n: sql<number>`count(*)::int` }).from(t)
    .where(and(inArray(t.baseId, bases.map((b) => b.id)), inArray(t.status, ["outbound", "returning", "staged", "stationed", "holding"]), sql`${t.type} <> ${ADMIRAL_RETURN_TYPE}`))
    .groupBy(t.baseId);
  const used = new Map(active.map((r) => [r.baseId, r.n]));
  for (const b of bases) {
    const sub = harborSub(bases, b.id);
    const s = settle(b.state, nowMs, balance, mods.get(b.id));
    // UX 0.43 (L-2): eine Zeile je Hafen; Leerlauf nur, wenn eine Handlung möglich ist. Die leere Bauschlange steht
    // als Bauempfehlung unter „Nächster Schritt“ (lage.ts advice), nicht mehr hier.
    const parts: { text: string; jump: LageRow["jump"] }[] = [];
    const free = TRAINERS.filter((id) => (s.buildings[id] ?? 0) >= 1 && !s.trainingQueue.some((o) => o.builtIn === id)
      && Object.keys(balance.units).some((u) => balance.units[u].builtIn === id && startTraining(s, u, 1, nowMs, balance, mods.get(b.id)).ok));
    if (free.length > 0) parts.push({ text: `Ausbildung frei: ${free.map(nameOf).join(", ")}`, jump: { to: "troops", baseId: b.id, seg: "ausbilden" } });
    const slots = missionSlots(s, balance) - (used.get(b.id) ?? 0);
    const fighters = Object.entries(s.units).some(([u, n]) => n > 0 && Object.values(balance.units[u]?.attack ?? {}).some((v) => Number(v) > 0));
    if (slots > 0 && fighters) parts.push({ text: slots === 1 ? "1 Missionsplatz frei" : `${slots} Missionsplätze frei`, jump: { to: "troops", baseId: b.id, seg: "einsatz" } });
    const cap = storageCapacity(s, balance, mods.get(b.id));
    const full = balance.resources.filter((r) => cap > 0 && (s.resources[r] ?? 0) >= STORAGE_NEAR_FULL * cap);
    if (full.length > 0) {
      const pct = (r: string) => Math.min(100, Math.floor(((s.resources[r] ?? 0) / cap) * 100));
      parts.push({ text: `Lager fast voll: ${full.map((r) => `${nameOf(r)} ${pct(r)} %`).join(", ")}`, jump: { to: "building", baseId: b.id, id: "lagerkomplex" } });
    }
    if (parts.length > 0) {
      const kind = parts.length > 1 ? "hafen" : parts[0].text.startsWith("Lager") ? "lager" : parts[0].text.startsWith("Ausbildung") ? "ausbildung-frei" : "missionsplatz";
      const icon = kind === "lager" ? "lagerkomplex" : kind === "ausbildung-frei" ? free[0] : kind === "missionsplatz" ? "anker" : "hafenkommandantur";
      out.push(row({ key: `hafen:${b.id}`, kind, icon, text: parts.map((p) => p.text).join(" · "), sub, jump: parts[0].jump }));
    }
    if (s.versorgungsmangel) {
      out.push(row({ key: `mangel:${b.id}`, kind: "versorgung", icon: "proviant", tone: "alarm", text: "Versorgungsmangel: keine Ausbildung, Angriff schwächer", sub, jump: { to: "building", baseId: b.id, id: "versorgungshof" } }));
    }
    const cu = catchUpView(s);
    if (cu && cu.credit > 0) {
      out.push(row({ key: `aufholhilfe:${b.id}`, kind: "aufholhilfe", icon: "kran", tone: "gut", text: `Aufholhilfe: ${fmtInt(cu.credit)} Baugutschrift bereit`, sub, jump: { to: "base", baseId: b.id } }));
    }
  }
  out.push(...(await expiringIntel(db, playerId, nowMs)));
  return out;
}

/** Eigene Lagebilder (Aufklärung, Erkundung) fremder Häfen mit viel Beute, die bald veralten – jüngstes je Ziel. */
async function expiringIntel(db: DbOrTx, playerId: number, nowMs: number): Promise<LageRow[]> {
  const stale = (balance as { intel?: { staleHours?: number } }).intel?.staleHours;
  if (!stale) return [];
  const r = tables.battleReport;
  const from = new Date(nowMs - stale * HOUR_MS);
  const rows = await db.select({ id: r.id, title: r.title, baseId: r.defenderBaseId, at: r.createdAt, scout: sql<unknown>`${r.report}->'scout'` }).from(r)
    .where(and(eq(r.attackerPlayerId, playerId), inArray(r.kind, ["aufklaerung", "spionage"]), isNotNull(r.defenderBaseId), gt(r.createdAt, from)))
    .orderBy(desc(r.createdAt)).limit(40);
  const seen = new Set<number>();
  const out: LageRow[] = [];
  for (const x of rows) {
    if (x.baseId === null || seen.has(x.baseId)) continue;
    seen.add(x.baseId);
    const expires = x.at.getTime() + stale * HOUR_MS;
    if (expires - nowMs > INTEL_EXPIRY_WARN_MS) continue;
    const sc = x.scout as { resources?: ResourceMap; protectedPerResource?: number } | null;
    if (!sc?.resources) continue;
    let value = 0;
    for (const [res, q] of Object.entries(sc.resources)) value += Math.max(0, q - (sc.protectedPerResource ?? 0)) * (balance.market.refPrice[res] ?? 0);
    if (value < LOHNEND_MIN_VALUE) continue;
    out.push(row({ key: `lagebild:${x.id}`, kind: "lagebild", atMs: expires, icon: "aufklaerung", text: `Lagebild veraltet bald: ${x.title.replace(/^[^:]*:\s*/, "")}`, sub: `Beute etwa ${fmtInt(value)} Warenwert`, jump: { to: "report", id: x.id } }));
  }
  return out;
}
