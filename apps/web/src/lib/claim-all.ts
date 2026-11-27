// „Alle abholen“ (TST-09): alle abholbereiten Belohnungen – Auftragsbuch (samt Abschluss), Tagesbefehle, Wochenziele,
// Erfolge – mit einem Knopf. Schmale Schnittstelle claimAll(): Der Server-Endpunkt `rewards.claimAll` (Welle 1, w1)
// erledigt alles in einer Transaktion; solange er fehlt (SERVER_CLAIM_ALL = false), laufen die vorhandenen
// Einzelabholungen nacheinander. In beiden Fällen gibt es danach EINE gebündelte, entprellte Folgeabfrage statt
// acht je Abholung (sonst HTTP 429 bei der Ratenbegrenzung von 120 Prozeduren je Minute).
import { queryClient, trpc, trpcClient } from "./trpc.ts";

/** Der Server-Endpunkt `rewards.claimAll` ist da (Welle 1); die Einzelabholung bleibt als Rückfallweg. */
export const SERVER_CLAIM_ALL = true;

export type ClaimAllResult =
  | { ok: true; claimed: { guide: number; daily: number; weekly: number; achievements: number; total: number }; rewards: Record<string, number>; lost: Record<string, number>; skipped?: { total: number } }
  | { ok: false; code: string };

const add = (into: Record<string, number>, from: Record<string, number> | null | undefined) => {
  for (const [k, v] of Object.entries(from ?? {})) if (typeof v === "number" && v > 0) into[k] = (into[k] ?? 0) + v;
};

/** Folgeabfragen nach dem Abholen: gesammelt und höchstens einmal je 500 ms. */
let flushTimer: ReturnType<typeof setTimeout> | null = null;
export function invalidateRewardsSoon(delayMs = 500): Promise<void> {
  return new Promise((resolve) => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const keys = [trpc.guide, trpc.daily, trpc.achievements, trpc.lage, trpc.base, trpc.social.ranking].map((r) => r.pathFilter().queryKey);
      void Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => resolve());
    }, delayMs);
  });
}

/** Einzelabholungen in Schleife (bis der Server-Endpunkt da ist). Abgelehnte einzelne Belohnungen werden übersprungen. */
async function claimEach(): Promise<ClaimAllResult> {
  const claimed = { guide: 0, daily: 0, weekly: 0, achievements: 0, total: 0 };
  const rewards: Record<string, number> = {};
  const lost: Record<string, number> = {};
  const key = () => crypto.randomUUID();
  const [guide, daily, weekly, ach] = await Promise.all([
    trpcClient.guide.get.query().catch(() => null),
    trpcClient.daily.get.query().catch(() => null),
    trpcClient.achievements.weekly.query().catch(() => null),
    trpcClient.achievements.get.query().catch(() => null),
  ]);
  if (guide?.hasBase) {
    for (const s of guide.steps.filter((x) => x.claimable)) {
      const r = await trpcClient.guide.claim.mutate({ key: key(), stepId: s.id });
      if (r.ok) { claimed.guide++; add(rewards, s.reward); }
    }
    const allClaimed = guide.steps.every((x) => x.claimed || x.claimable);
    if (!guide.final.claimed && (guide.final.claimable || allClaimed)) {
      const r = await trpcClient.guide.claimFinal.mutate({ key: key() });
      if (r.ok) { claimed.guide++; add(rewards, guide.final.reward); }
    }
  }
  if (daily?.hasBase) {
    for (const c of daily.challenges.filter((x) => x.done && !x.claimed)) {
      const r = await trpcClient.daily.claim.mutate({ key: key(), id: c.id });
      if (r.ok) { claimed.daily++; add(rewards, c.reward); add(lost, "lost" in r ? (r.lost as Record<string, number> | null) : null); }
    }
  }
  if (weekly?.hasBase) {
    for (const g of [...weekly.goals, ...weekly.older].filter((x) => x.done && !x.claimed)) {
      const r = await trpcClient.achievements.claimWeekly.mutate({ key: key(), id: g.id });
      if (r.ok) { claimed.weekly++; add(rewards, g.reward); add(lost, r.lost); }
    }
  }
  if (ach) {
    for (const a of ach.achievements) {
      for (const t of a.tiers.filter((x) => x.unlocked && !x.claimed)) {
        const r = await trpcClient.achievements.claim.mutate({ key: key(), id: a.id, tier: t.tier });
        if (r.ok) { claimed.achievements++; add(rewards, t.reward); add(lost, r.lost); }
      }
    }
  }
  claimed.total = claimed.guide + claimed.daily + claimed.weekly + claimed.achievements;
  return claimed.total > 0 ? { ok: true, claimed, rewards, lost } : { ok: false, code: "nothing" };
}

/** Alles Abholbereite abholen; danach eine gebündelte Folgeabfrage. */
export async function claimAll(): Promise<ClaimAllResult> {
  try {
    if (SERVER_CLAIM_ALL) return await trpcClient.rewards.claimAll.mutate({ key: crypto.randomUUID() });
    return await claimEach();
  } finally {
    await invalidateRewardsSoon(0);
  }
}
