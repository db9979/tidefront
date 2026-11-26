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

export type ChangeKind = "base" | "missions" | "reports" | "market" | "map" | "messages" | "season" | "alliance";

/** Arten von Benachrichtigungen (Push und E-Mail). */
export const NOTICE_KINDS = ["attack", "report", "build", "training", "fleet", "delivery", "ops", "test", "market"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** Eine Benachrichtigung an einen Spieler. facts: Kennzahlen (z. B. Ankunft in, Beute) für die E-Mail. */
export interface Notice {
  kind: NoticeKind;
  title: string;
  body: string;
  /** Pfad in der App, z. B. "/?tab=berichte". */
  url?: string;
  tag?: string;
  facts?: [string, string][];
}

export interface NoticeJob {
  playerId: number;
  notice: Notice;
}

export interface Engine {
  db: Db;
  /** Benachrichtigt Spieler über Änderungen (WebSocket über Valkey); null = alle. */
  notify: (playerIds: number[] | null, kind: ChangeKind) => void;
  log: (msg: string, data?: unknown) => void;
  /** Benachrichtigungen (Push, E-Mail) nach erfolgreichem Commit; fehlt der Hook, wird nichts versandt. */
  push?: (jobs: NoticeJob[]) => void;
}

export class GameError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
