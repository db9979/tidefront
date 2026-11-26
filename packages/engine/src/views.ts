// Lesemodelle für die Oberfläche. Lesen verarbeitet zuerst fällige Ereignisse des eigenen Stützpunkts.
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  aircraftSlots,
  aircraftSlotsUsed,
  bunkerProtection,
  commandPoints,
  harborCreditLimit,
  harborMarketUnlocked,
  isAttackDetected,
  isNestRespawned,
  maxAllowedLevel,
  missionSlots,
  planMission,
  plannedLevel,
  productionRates,
  protectionStatus,
  radarWarningMinutes,
  settle,
  storageCapacity,
  trainingSecondsPerUnit,
  upgradeCost,
  upgradeSeconds,
  wreckRemaining,
  nightShieldWindow,
  market as marketCore,
  type BaseState,
  type Modifiers,
  type Counts,
  type Mission,
  type ResourceMap,
} from "@tidefront/game-core";
import { hexCenter, hexDistanceKm, nearestTradePort } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, marketBalance, type Engine } from "./context.ts";
import { processDueForBase } from "./events.ts";
import { activeMissionCount, baseOfPlayer } from "./store.ts";
import { loadMarket, targetAt } from "./commands.ts";
import { effectiveMarketRefs, marketRefs } from "./market-news.ts";
// Weltereignisse: Vorschau einer Mission gegen ein Ereignis.
import { previewAgainstEvent } from "./world-events-missions.ts";
import { modifierBreakdown, modsOf } from "./modifiers.ts";
import { veteranView } from "./veterans.ts";
import { withLuckFactors } from "./battle-stats.ts";
import { researchView } from "./research.ts";
import { diplomacyBlock } from "./alliance-core.ts";
import { intelView } from "./espionage.ts";

/** Ist ein feindlicher Verband auf dem Anmarsch und schon vom Radar erfasst? (Radar mit `mods`, Tarnung je Verband.) */
export async function incomingDetected(tx: DbOrTx, baseId: number, state: BaseState, nowMs: number, mods?: Modifiers): Promise<boolean> {
  const warn = radarWarningMinutes(state, balance, mods);
  const rows = await tx
    .select({ arriveAt: tables.mission.arriveAt, plan: tables.mission.plan })
    .from(tables.mission)
    .where(and(
      eq(tables.mission.targetKind, "base"),
      eq(tables.mission.targetId, baseId),
      eq(tables.mission.status, "outbound"),
      inArray(tables.mission.type, ["ueberfall", "kartell"]),
    ));
  return rows.some((r) => isAttackDetected(r.arriveAt.getTime(), nowMs, warn * warnFactor(r.plan)));
}

/** Tarnfaktor eines Verbands (Mission.warningFactor), 1 ohne Tarnung. */
function warnFactor(plan: unknown): number {
  return (plan as Mission | null)?.warningFactor ?? 1;
}

export async function baseView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const own = await baseOfPlayer(engine.db, playerId);
  if (!own) return { serverNow: nowMs, base: null };
  await processDueForBase(engine, own.id, nowMs);
  const row = (await baseOfPlayer(engine.db, playerId))!;
  const { total: mods, sources: modSources } = await modifierBreakdown(engine.db, row, nowMs);
  const s = settle(row.state, nowMs, balance, mods);
  const rates = productionRates(s, balance, mods);
  const buildings = Object.keys(balance.buildings).map((id) => {
    const level = s.buildings[id] ?? 0;
    // Nächster Ausbau baut auf der geplanten Stufe auf (eingereihte Aufträge zählen mit).
    const planned = plannedLevel(s, id);
    return {
      id,
      level,
      planned,
      maxAllowed: maxAllowedLevel(s, id, balance),
      cost: planned < balance.building.maxLevel ? upgradeCost(id, planned, balance) : null,
      seconds: planned < balance.building.maxLevel ? upgradeSeconds(id, planned, balance, mods) : null,
    };
  });
  const units = Object.entries(balance.units).map(([id, def]) => {
    const lvl = s.buildings[def.builtIn ?? ""] ?? 0;
    return {
      id,
      home: s.units[id] ?? 0,
      away: s.unitsAway[id] ?? 0,
      builtIn: def.builtIn ?? "",
      secondsEach: lvl >= 1 ? trainingSecondsPerUnit(id, lvl, balance, mods) : null,
    };
  });
  const missions = await engine.db
    .select()
    .from(tables.mission)
    .where(and(eq(tables.mission.baseId, own.id), inArray(tables.mission.status, ["outbound", "returning"])))
    .orderBy(tables.mission.arriveAt);
  const incomingRows = await engine.db
    .select()
    .from(tables.mission)
    .where(and(
      eq(tables.mission.targetKind, "base"),
      eq(tables.mission.targetId, own.id),
      eq(tables.mission.status, "outbound"),
    ));
  const warn = radarWarningMinutes(s, balance, mods);
  // Absender nur bei Transporten (Angreifer bleiben bis zum Kampf unbekannt).
  const senderIds = incomingRows.filter((m) => m.type === "transport" && m.baseId !== null).map((m) => m.baseId!);
  const senders = senderIds.length
    ? new Map((await engine.db.select({ id: tables.base.id, name: tables.base.name }).from(tables.base).where(inArray(tables.base.id, senderIds))).map((r) => [r.id, r.name]))
    : new Map<number, string>();
  const incoming = incomingRows
    // Spionageaufträge bleiben unsichtbar (kein Radar).
    .filter((m) => m.type !== "spionage")
    .filter((m) => m.type === "transport" || isAttackDetected(m.arriveAt.getTime(), nowMs, warn * warnFactor(m.plan)))
    .map((m) => ({
      id: m.id,
      type: m.type,
      arriveAtMs: m.arriveAt.getTime(),
      units: m.type === "kartell" ? ((m.plan as { units: Counts }).units) : null,
      from: m.type === "transport" && m.baseId !== null ? senders.get(m.baseId) ?? null : null,
    }));
  const deliveries = await engine.db
    .select()
    .from(tables.delivery)
    .where(and(eq(tables.delivery.baseId, own.id), eq(tables.delivery.status, "underway")));
  const [p] = await engine.db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  const status = protectionStatus(s.protection, nowMs, balance);
  return {
    serverNow: nowMs,
    base: {
      id: own.id,
      name: own.name,
      col: own.col,
      row: own.row,
      resources: s.resources,
      capacity: storageCapacity(s, balance, mods),
      rates: rates.perHour,
      power: { supply: rates.powerSupply, demand: rates.powerDemand, factor: rates.powerFactor },
      upkeepPerHour: rates.upkeepPerHour,
      versorgungsmangel: s.versorgungsmangel,
      buildings,
      buildQueue: s.buildQueue,
      buildQueueSlots: balance.building.queueSlots,
      trainingQueue: s.trainingQueue,
      units,
      defenses: Object.keys(balance.defenses).map((id) => ({ id, count: s.defenses[id] ?? 0 })),
      commandPoints: commandPoints(s, balance),
      missionSlots: missionSlots(s, balance),
      activeMissions: missions.length,
      aircraftSlots: { used: aircraftSlotsUsed(s, balance), total: aircraftSlots(s, balance) },
      bunkerProtection: bunkerProtection(s, balance, mods),
      radarWarningMinutes: warn,
      protection: {
        ...s.protection,
        status: status.reason,
        nightWindow: nightShieldWindow(s.protection, nowMs, balance),
      },
      market: {
        unlocked: harborMarketUnlocked(s, balance),
        creditLimit: harborCreditLimit(s, balance),
        credits: (p?.trader as { credits: number } | undefined)?.credits ?? 0,
        port: nearestTradePort(own),
      },
      missions: missions.map((m) => ({
        id: m.id,
        type: m.type,
        status: m.status,
        target: { kind: m.targetKind, col: m.targetCol, row: m.targetRow },
        units: (m.plan as Mission).units,
        arriveAtMs: m.arriveAt.getTime(),
        returnAtMs: m.returnAt?.getTime() ?? (m.plan as Mission).returnAtMs,
        departAtMs: (m.plan as Mission).departAtMs,
        recalled: (m.plan as Mission).recalledAtMs !== undefined,
        returning: m.returning as Counts | null,
        cargoHome: m.cargoHome as ResourceMap | null,
        reportId: m.reportId,
        spy: (m.plan as { spy?: { kind: string; building?: string } }).spy ?? null,
      })),
      incoming,
      deliveries: deliveries.map((d) => ({ id: d.id, resource: d.resource, qty: d.qty, arriveAtMs: d.arriveAt.getTime() })),
      /** Alle wirksamen Modifikatoren (Forschung und weitere Quellen) für Info-Blätter. */
      modifiers: mods,
      /** Dieselben Modifikatoren nach Quelle getrennt (Forschung, Veteranen, …) für die Wertaufschlüsselung. */
      modifierSources: modSources.filter((x) => Object.keys(x.mods).length > 0),
      veterans: veteranView(s),
      research: researchView(s, mods),
      intel: intelView(s, mods, nowMs),
    },
  };
}

export async function mapView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const bases = await engine.db
    .select({ id: tables.base.id, name: tables.base.name, col: tables.base.col, row: tables.base.row, playerId: tables.base.playerId, owner: tables.player.name, state: tables.base.state })
    .from(tables.base)
    .innerJoin(tables.player, eq(tables.player.id, tables.base.playerId));
  const nests = await engine.db.select().from(tables.nest);
  const wrecks = await engine.db.select().from(tables.wreck);
  return {
    serverNow: nowMs,
    bases: bases.map((b) => ({
      id: b.id,
      name: b.name,
      col: b.col,
      row: b.row,
      owner: b.owner,
      own: b.playerId === playerId,
      protection: protectionStatus((b.state as BaseState).protection, nowMs, balance).reason,
    })),
    nests: nests.map((n) => ({
      id: n.id,
      col: n.col,
      row: n.row,
      level: n.level,
      empty: n.defeatedAt !== null && !isNestRespawned(n.defeatedAt.getTime(), nowMs, balance),
      respawnAtMs: n.defeatedAt ? n.defeatedAt.getTime() + balance.pirates.nestRespawnHours * 3600000 : null,
    })),
    wrecks: wrecks
      .map((w) => ({ col: w.col, row: w.row, ...(wreckRemaining({ stahl: w.stahl, elektronik: w.elektronik, createdAtMs: w.createdAt.getTime() }, nowMs, balance) as { stahl: number; elektronik: number }) }))
      .filter((w) => w.stahl + w.elektronik > 0),
  };
}

/** Vorschau einer Mission ohne Änderung: Entfernung, Reisezeit, Treibstoff, Ablehnungsgrund. */
export async function missionPreview(
  engine: Engine,
  playerId: number,
  input: { type: string; units: Counts; col: number; row: number; cargo?: ResourceMap; eventId?: number },
) {
  const nowMs = Date.now();
  const own = await baseOfPlayer(engine.db, playerId);
  if (!own) return { ok: false as const, code: "no_base" };
  if (input.eventId !== undefined) return previewAgainstEvent(engine.db, playerId, own, { ...input, eventId: input.eventId }, nowMs);
  const target = await targetAt(engine.db as never, input.col, input.row);
  const distanceKm = hexDistanceKm(own, input);
  if (!target) return { ok: false as const, code: "no_target", distanceKm };
  // Dieselben Ablehnungen wie launchMission, schon in der Vorschau (Planung zeigt den Grund).
  if (target.kind === "base" && target.playerId === playerId) return { ok: false as const, code: "own_base", distanceKm };
  if (input.type === "ueberfall" && target.kind === "base" && target.playerId !== null) {
    const d = await diplomacyBlock(engine.db, playerId, target.playerId, nowMs);
    if (d) return { ok: false as const, code: d, distanceKm };
  }
  if (input.type === "transport" && target.kind !== "base") return { ok: false as const, code: "transport_needs_base", distanceKm };
  if (input.type === "ueberfall" && target.kind === "nest" && target.defeatedAt && !isNestRespawned(target.defeatedAt.getTime(), nowMs, balance)) {
    return { ok: false as const, code: "nest_empty", distanceKm };
  }
  const mods = await modsOf(engine.db, own, nowMs);
  const r = planMission(
    settle(own.state, nowMs, balance, mods),
    {
      type: input.type,
      units: input.units,
      origin: hexCenter(own.col, own.row),
      target: hexCenter(input.col, input.row),
      activeMissions: await activeMissionCount(engine.db, own.id),
      cargo: input.cargo,
      targetProtection: target.kind === "base" ? target.state!.protection : undefined,
    },
    nowMs,
    balance,
    mods,
  );
  if (!r.ok) return { ok: false as const, code: r.code, distanceKm };
  return {
    ok: true as const,
    distanceKm,
    travelSeconds: r.mission.travelSeconds,
    fuelCost: r.mission.fuelCost,
    arriveAtMs: r.mission.arriveAtMs,
    returnAtMs: r.mission.returnAtMs,
    target: { kind: target.kind, own: target.playerId === playerId },
  };
}

export async function reportList(engine: Engine, playerId: number) {
  const rows = await engine.db
    .select({
      id: tables.battleReport.id,
      kind: tables.battleReport.kind,
      title: tables.battleReport.title,
      winner: tables.battleReport.winner,
      attackerPlayerId: tables.battleReport.attackerPlayerId,
      createdAt: tables.battleReport.createdAt,
      from: sql<string | null>`coalesce(${tables.battleReport.report}->>'from', ${tables.battleReport.report}->'spy'->>'from')`,
    })
    .from(tables.battleReport)
    .where(or(eq(tables.battleReport.attackerPlayerId, playerId), eq(tables.battleReport.defenderPlayerId, playerId)))
    .orderBy(desc(tables.battleReport.createdAt))
    .limit(100);
  return rows.map((r) => {
    const role = reportRole(r.kind, r.attackerPlayerId, playerId);
    return {
      id: r.id,
      kind: r.kind,
      // Empfänger einer Lieferung sieht den Absender statt des eigenen Hafens.
      title: reportTitle(r.kind, role, r.title, r.from),
      atMs: r.createdAt.getTime(),
      role,
      won: r.winner === null ? null : (r.winner === "attacker") === (r.attackerPlayerId === playerId),
    };
  });
}

/** Titel aus Sicht des Lesers: Lieferung mit Absender, enttarnter fremder Spion mit Absender. */
function reportTitle(kind: string, role: string, title: string, from: string | null): string {
  if (role === "recipient") return `Lieferung von ${from ?? "?"}`;
  if (kind === "spionage" && role === "defender") return `Fremder Spion enttarnt – Absender ${from ?? "?"}`;
  return title;
}

/** Rolle des Lesers: eigene Mission, angegriffener Hafen oder Empfänger einer Lieferung. */
export function reportRole(kind: string, attackerPlayerId: number | null, playerId: number): "attacker" | "defender" | "recipient" {
  if (attackerPlayerId === playerId) return "attacker";
  return kind === "transport" ? "recipient" : "defender";
}

export async function reportGet(engine: Engine, playerId: number, id: number) {
  const [r] = await engine.db
    .select()
    .from(tables.battleReport)
    .where(and(
      eq(tables.battleReport.id, id),
      or(eq(tables.battleReport.attackerPlayerId, playerId), eq(tables.battleReport.defenderPlayerId, playerId)),
    ));
  if (!r) return null;
  const role = reportRole(r.kind, r.attackerPlayerId, playerId);
  return {
    id: r.id,
    kind: r.kind,
    title: reportTitle(r.kind, role, r.title, (r.report as { spy?: { from?: string }; from?: string }).spy?.from ?? (r.report as { from?: string }).from ?? null),
    atMs: r.createdAt.getTime(),
    role,
    winner: r.winner,
    seed: r.seed,
    balanceVersion: r.balanceVersion,
    // Kampfberichte mit Würfen (v1.4) erhalten je Phase den Würfelfaktor für die Anzeige.
    data: withLuckFactors(r.report as Record<string, unknown>),
  };
}

export async function marketView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const m = await engine.db.transaction((tx) => loadMarket(tx));
  // Marktnachrichten: Kurs und Richtwert beziehen sich auf den effektiven Richtwert.
  const refs = await marketRefs(engine.db, nowMs);
  const [p] = await engine.db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  const trader = p?.trader as Omit<marketCore.TraderState, "stock">;
  const own = await baseOfPlayer(engine.db, playerId);
  const mods = own ? await modsOf(engine.db, own, nowMs) : undefined;
  const cap = own ? storageCapacity(settle(own.state, nowMs, balance, mods), balance, mods) : 0;
  const dayIndex = marketCore.utcDayIndex(nowMs);
  return {
    serverNow: nowMs,
    resources: balance.resources.map((r) => {
      const st = m[r as marketCore.ResourceId];
      return {
        id: r,
        price: st ? marketCore.currentPrice(st, r as marketCore.ResourceId, marketBalance, nowMs, refs.refs) : refs.refs[r],
        /** Effektiver Richtwert (mit Marktnachrichten); baseRef = Grundrichtwert aus balance.json. */
        ref: refs.refs[r],
        baseRef: balance.market.refPrice[r],
        haltedUntilMs: st?.haltedUntilMs ?? 0,
        history: st?.history ?? [],
        dailyUsed: trader && trader.dailyDayIndex === dayIndex ? (trader.dailyVolume[r as marketCore.ResourceId] ?? 0) : 0,
        dailyLimit: Math.floor(balance.market.dailyLimitShareOfStorage * cap),
      };
    }),
    credits: trader?.credits ?? 0,
    fee: balance.market.fee,
  };
}

export async function marketQuote(engine: Engine, req: { side: "buy" | "sell"; resource: string; qty: number }) {
  const nowMs = Date.now();
  const m = await engine.db.transaction((tx) => loadMarket(tx));
  return marketCore.quote(m, req as never, marketBalance, nowMs, await effectiveMarketRefs(engine.db, nowMs));
}

export async function missionsCount(engine: Engine, baseId: number) {
  return activeMissionCount(engine.db, baseId);
}
