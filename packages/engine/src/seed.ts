// Startdaten nach der Migration: Nester, Marktzeilen, Einladungscodes (idempotent).
import { sql } from "drizzle-orm";
import { market as marketCore } from "@tidefront/game-core";
import { nestSites } from "@tidefront/world";
import { tables, type Db } from "@tidefront/db";
import { marketBalance } from "./context.ts";
import { ensureSeason } from "./season.ts";

/** INVITE_CODES="CODE1:5,CODE2" -> Code mit Anzahl Nutzungen (Vorgabe 1). */
export function parseInviteCodes(raw: string | undefined): { code: string; maxUses: number }[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [code, uses] = s.split(":");
      return { code: code.trim(), maxUses: Math.max(1, Number(uses ?? 1) || 1) };
    });
}

export async function seed(db: Db, inviteCodes: string | undefined): Promise<{ nests: number; invites: number; season: number }> {
  const sites = nestSites();
  await db
    .insert(tables.nest)
    .values(sites.map((s) => ({ col: s.col, row: s.row, level: s.level })))
    .onConflictDoNothing();
  const m = marketCore.createMarketState(marketBalance, Date.now());
  await db
    .insert(tables.market)
    .values(Object.entries(m).map(([resource, state]) => ({ resource, state })))
    .onConflictDoNothing();
  const codes = parseInviteCodes(inviteCodes);
  for (const c of codes) {
    await db
      .insert(tables.inviteCode)
      .values(c)
      .onConflictDoUpdate({ target: tables.inviteCode.code, set: { maxUses: sql`greatest(${tables.inviteCode.maxUses}, ${c.maxUses})` } });
  }
  const season = await ensureSeason(db, Date.now());
  return { nests: sites.length, invites: codes.length, season: season.number };
}
