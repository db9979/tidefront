import type { Balance, market } from "@tidefront/game-core";
import type { Db } from "@tidefront/db";
import balanceJson from "../../balance/v1/balance.json" with { type: "json" };

export const balance = balanceJson as unknown as Balance;
/** Dieselbe Balance in der Sicht des Börsenkerns. */
export const marketBalance = balanceJson as unknown as market.MarketBalance;

/** Vorlauf eines Kartell-Überfalls zwischen Auslaufen und Ankunft. */
export const RAID_LEAD_MS = 60 * 60000;
export const SESSION_DAYS = 30;
export const MAX_EVENT_ATTEMPTS = 5;

export type ChangeKind = "base" | "missions" | "reports" | "market" | "map";

export interface Engine {
  db: Db;
  /** Benachrichtigt Spieler über Änderungen (WebSocket über Valkey); null = alle. */
  notify: (playerIds: number[] | null, kind: ChangeKind) => void;
  log: (msg: string, data?: unknown) => void;
}

export class GameError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
