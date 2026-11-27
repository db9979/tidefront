// KI-Spieler in der Verwaltung: Liste mit Spielweise, Schaltern, Hafen und letzten Aktionen; Server-Einstellungen.
import { tables } from "@tidefront/db";
import { inArray } from "drizzle-orm";
import type { Engine } from "./context.ts";
import { BOT_PROFILES, PROFILE_TEXT, botsEnabled, botsMax, loadBots } from "./bots-core.ts";

export async function botsAdminView(engine: Engine) {
  const bots = await loadBots(engine.db);
  const bases = bots.length
    ? await engine.db.select({ playerId: tables.base.playerId, name: tables.base.name, col: tables.base.col, row: tables.base.row, isHome: tables.base.isHome })
      .from(tables.base).where(inArray(tables.base.playerId, bots.map((b) => b.id)))
    : [];
  return {
    serverNow: Date.now(),
    enabled: await botsEnabled(engine.db),
    max: await botsMax(engine.db),
    profiles: BOT_PROFILES.map((id) => ({ id, name: PROFILE_TEXT[id] })),
    bots: bots.map((b) => {
      const own = bases.filter((x) => x.playerId === b.id);
      const home = own.find((x) => x.isHome) ?? null;
      return {
        id: b.id,
        name: b.name,
        profile: b.profile,
        profileName: PROFILE_TEXT[b.profile],
        active: b.settings.active,
        attackHumans: b.settings.attackHumans,
        removing: !!b.settings.removing,
        home: home ? { name: home.name, col: home.col, row: home.row } : null,
        bases: own.length,
        nextActAtMs: b.state.nextActAt ?? null,
        lastTurnAtMs: b.state.lastTurnAtMs ?? null,
        lastTurnMs: b.state.lastTurnMs ?? null,
        errors: b.state.errors ?? 0,
        log: (b.state.log ?? []).slice(0, 12),
      };
    }),
  };
}
