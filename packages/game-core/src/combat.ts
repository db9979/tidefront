import type {
  AttackerInput,
  Balance,
  BattleReport,
  Counts,
  DefenderInput,
  PhaseName,
  PhaseReport,
  ResourceMap,
  Result,
  Side,
} from "./types.ts";
import type { Rng } from "./rng.ts";
import { mulberry32, randomFactor } from "./rng.ts";
import { SUPPLY_SHORTAGE_ATTACK_FACTOR } from "./economy.ts";
import type { Stat } from "./combat-stats.ts";
import {
  applyDamage,
  beginPhase,
  buildStats,
  endPhase,
  normalizeCounts,
  outcome,
  pick,
  totalHp,
  volley,
  withModifiers,
} from "./combat-stats.ts";
import type { Modifiers } from "./modifiers.ts";
import { modValue } from "./modifiers.ts";

/** "Pioniere halbieren den Schaden" der Minensperren (REGELN.md, Abschnitt Kampf). */
export const PIONEER_MINE_FACTOR = 0.5;

export const PHASE_NAMES: readonly PhaseName[] = ["luftkampf", "luftschlag", "ubootangriff", "seegefecht", "landung"];

/**
 * Beute nach einem Sieg. Feste Beute (Piratennest) oder Anteil am ungeschützten Bestand mal
 * Wiederholungsfaktor (und bei Schwachzielen mal weakTargetLootFactor); insgesamt durch die Ladekapazität begrenzt, bei Knappheit proportional
 * gekürzt; je Ressource abgerundet. `mods.loot` (Angreifer) wirkt auf den Anteil, nicht auf feste Beute.
 */
export function computeLoot(
  defender: Pick<DefenderInput, "resources" | "protectedPerResource" | "fixedLoot">,
  cargoCapacity: number,
  priorAttacksInWindow: number,
  balance: Balance,
  weakTarget = false,
  mods?: Modifiers,
): ResourceMap {
  const raw: ResourceMap = {};
  let total = 0;
  const factors = balance.loot.repeatFactors;
  const repeat = factors.length === 0 ? 1 : factors[Math.min(Math.max(0, priorAttacksInWindow), factors.length - 1)];
  for (const r of balance.resources) {
    let amount = 0;
    if (defender.fixedLoot !== undefined) {
      amount = defender.fixedLoot[r] ?? 0;
    } else {
      const unprotected = Math.max(0, (defender.resources?.[r] ?? 0) - (defender.protectedPerResource ?? 0));
      amount = unprotected * balance.loot.maxShareOfUnprotected * modValue(mods, "loot") * repeat;
      if (weakTarget) amount *= balance.loot.weakTargetLootFactor;
    }
    raw[r] = Math.max(0, amount);
    total += raw[r];
  }
  const scale = total > cargoCapacity ? Math.max(0, cargoCapacity) / total : 1;
  const loot: ResourceMap = {};
  for (const r of balance.resources) loot[r] = Math.floor(raw[r] * scale + 1e-9);
  return loot;
}

/**
 * Trägt einen Kampf in fünf Phasen aus (Luftkampf, Luftschlag, U-Boot-Angriff, Seegefecht, Landung).
 * Rein und deterministisch: gleicher Seed und gleiche Eingabe ergeben denselben Bericht.
 * Modifikatoren wirken je Seite getrennt (attacker.modifiers, defender.modifiers): Lebenspunkte und Angriff
 * über eine eigene Werte-Tabelle je Seite, Minenschaden und Ladung/Beute beim Angreifer.
 * Codes: unknown_unit, bad_count.
 */
export function resolveBattle(
  attacker: AttackerInput,
  defender: DefenderInput,
  balance: Balance,
  seed: number,
): Result<{ report: BattleReport }> {
  const table = buildStats(balance);
  // Eine Werte-Tabelle je Seite; ohne Modifikatoren ist es dieselbe.
  const tA = withModifiers(table, attacker.modifiers);
  const tD = withModifiers(table, defender.modifiers);
  const isUnit = (id: string) => Object.hasOwn(table.byId, id) && table.byId[id].kind !== "defense";
  const isDefense = (id: string) => Object.hasOwn(table.byId, id) && table.byId[id].kind === "defense";

  const aIn = normalizeCounts(attacker.units, isUnit);
  if (!aIn.ok) return aIn;
  const dUnits = normalizeCounts(defender.units, isUnit);
  if (!dUnits.ok) return dUnits;
  const dDefs = normalizeCounts(defender.defenses, isDefense);
  if (!dDefs.ok) return dDefs;

  const A: Counts = { ...aIn.counts };
  const D: Counts = { ...dUnits.counts, ...dDefs.counts };
  const beforeA: Counts = { ...A };
  const beforeD: Counts = { ...D };

  const rng: Rng = mulberry32(seed);
  // Restschaden je Einheitentyp, über alle Runden und Phasen.
  const carryA: Record<string, number> = {};
  const carryD: Record<string, number> = {};
  const spread = balance.combat.randomSpread;
  const maxRounds = balance.combat.maxRoundsPerPhase;
  const moraleA = attacker.versorgungsmangel ? SUPPLY_SHORTAGE_ATTACK_FACTOR : 1;
  const moraleD = defender.versorgungsmangel ? SUPPLY_SHORTAGE_ATTACK_FACTOR : 1;
  // Versorgungsmangel schwächt nur Einheiten, nicht Anlagen.
  const withMorale = (morale: number, value: number, shooter: Stat) =>
    shooter.kind === "defense" ? value : value * morale;

  const phases: PhaseReport[] = [];

  // ------------------------------------------------------------ 1. Luftkampf
  {
    const draft = beginPhase("luftkampf", A, D);
    const isFighter = (s: Stat) => s.kind === "fighter";
    let skip: string | null = null;
    const hasA = pick(tA, A, isFighter).length > 0;
    const hasD = pick(tD, D, isFighter).length > 0;
    if (!hasA && !hasD) skip = "no_fighters";
    else if (!hasA || !hasD) skip = "no_opponent";
    else {
      while (draft.rounds < maxRounds) {
        const fa = pick(tA, A, isFighter);
        const fd = pick(tD, D, isFighter);
        if (fa.length === 0 || fd.length === 0) break;
        draft.rounds++;
        const ra = randomFactor(rng, spread);
        const rd = randomFactor(rng, spread);
        const toD = volley(fa, fd, (s) => withMorale(moraleA, s.attack.luft, s), ra, draft.damage.attacker);
        const toA = volley(fd, fa, (s) => withMorale(moraleD, s.attack.luft, s), rd, draft.damage.defender);
        applyDamage(tD, D, toD, carryD);
        applyDamage(tA, A, toA, carryA);
      }
    }
    phases.push(endPhase(draft, A, D, skip, table));
  }
  const fighterHpA = totalHp(pick(tA, A, (s) => s.kind === "fighter"));
  const fighterHpD = totalHp(pick(tD, D, (s) => s.kind === "fighter"));
  const airSuperiority: Side | null =
    fighterHpA > fighterHpD ? "attacker" : fighterHpD > fighterHpA ? "defender" : null;

  // ------------------------------------------------------------ 2. Luftschlag
  {
    const draft = beginPhase("luftschlag", A, D);
    const isBomber = (s: Stat) => s.kind === "bomber";
    const firesAtAir = (s: Stat) => (s.kind === "ship" || s.kind === "defense") && s.attack.luft > 0;
    const strikeTarget = (s: Stat) => s.kind === "ship" || s.kind === "defense";
    const strikeValue = (s: Stat, t: Stat) => (t.kind === "defense" ? s.attack.anlage : s.attack.see);
    const c = balance.combat;
    const bomberFactor = (side: Side) =>
      airSuperiority === null ? 1 : airSuperiority === side ? c.airSuperiorityBomberBonus : c.airSuperiorityBomberMalus;
    let skip: string | null = null;
    if (pick(tA, A, isBomber).length === 0 && pick(tD, D, isBomber).length === 0) {
      skip = "no_bombers";
    } else {
      while (draft.rounds < maxRounds) {
        const canA = pick(tA, A, isBomber).length > 0 && pick(tD, D, strikeTarget).length > 0;
        const canD = pick(tD, D, isBomber).length > 0 && pick(tA, A, strikeTarget).length > 0;
        if (!canA && !canD) break;
        draft.rounds++;
        // Zuerst die Flugabwehr (Flak und Schiffe) auf die Bomber.
        const ra = randomFactor(rng, spread);
        const rd = randomFactor(rng, spread);
        const flakOnA = volley(
          pick(tD, D, firesAtAir),
          pick(tA, A, isBomber),
          (s) => withMorale(moraleD, s.attack.luft, s),
          rd,
          draft.damage.defender,
        );
        const flakOnD = volley(
          pick(tA, A, firesAtAir),
          pick(tD, D, isBomber),
          (s) => withMorale(moraleA, s.attack.luft, s),
          ra,
          draft.damage.attacker,
        );
        applyDamage(tA, A, flakOnA, carryA);
        applyDamage(tD, D, flakOnD, carryD);
        // Dann schlagen die überlebenden Bomber beider Seiten gleichzeitig zu.
        const sa = randomFactor(rng, spread);
        const sd = randomFactor(rng, spread);
        const strikeOnD = volley(
          pick(tA, A, isBomber),
          pick(tD, D, strikeTarget),
          (s, t) => withMorale(moraleA, strikeValue(s, t), s),
          sa * bomberFactor("attacker"),
          draft.damage.attacker,
        );
        const strikeOnA = volley(
          pick(tD, D, isBomber),
          pick(tA, A, strikeTarget),
          (s, t) => withMorale(moraleD, strikeValue(s, t), s),
          sd * bomberFactor("defender"),
          draft.damage.defender,
        );
        applyDamage(tD, D, strikeOnD, carryD);
        applyDamage(tA, A, strikeOnA, carryA);
      }
      if (draft.rounds === 0) skip = "no_targets";
    }
    phases.push(endPhase(draft, A, D, skip, table));
  }

  // ------------------------------------------------------------ 3. U-Boot-Angriff
  // Aus dem Verborgenen: Die U-Boote beider Seiten feuern gleichzeitig Torpedos (`see`) auf die
  // Überwasserschiffe des Gegners. Niemand schießt zurück, U-Jagd wirkt erst im Seegefecht.
  const isSub = (s: Stat) => s.kind === "sub";
  const isSurface = (s: Stat) => s.kind === "ship";
  {
    const draft = beginPhase("ubootangriff", A, D);
    const salvos = balance.combat.torpedoSalvos ?? 1;
    let skip: string | null = null;
    if (pick(tA, A, isSub).length === 0 && pick(tD, D, isSub).length === 0) skip = "no_submarines";
    else {
      while (draft.rounds < salvos) {
        const canA = pick(tA, A, isSub).length > 0 && pick(tD, D, isSurface).length > 0;
        const canD = pick(tD, D, isSub).length > 0 && pick(tA, A, isSurface).length > 0;
        if (!canA && !canD) break;
        draft.rounds++;
        const ra = randomFactor(rng, spread);
        const rd = randomFactor(rng, spread);
        const toD = volley(pick(tA, A, isSub), pick(tD, D, isSurface), (s) => withMorale(moraleA, s.attack.see, s), ra, draft.damage.attacker);
        const toA = volley(pick(tD, D, isSub), pick(tA, A, isSurface), (s) => withMorale(moraleD, s.attack.see, s), rd, draft.damage.defender);
        applyDamage(tD, D, toD, carryD);
        applyDamage(tA, A, toA, carryA);
      }
      if (draft.rounds === 0) skip = "no_targets";
    }
    phases.push(endPhase(draft, A, D, skip, table));
  }

  // ------------------------------------------------------------ 4. Seegefecht
  {
    const draft = beginPhase("seegefecht", A, D);
    const isShip = (s: Stat) => s.kind === "ship" || s.kind === "sub";
    // Verteidiger: Schiffe und alle Anlagen mit See-Angriff (Küstenbatterien feuern mit).
    const defSea = (s: Stat) => isShip(s) || (s.kind === "defense" && s.attack.see > 0);
    // Überwasserziele: Schiffe (`see`) und Küstenbatterien (`anlage`); U-Boote sind getaucht.
    const surfaceTarget = (s: Stat) => s.kind === "ship" || s.kind === "defense";
    const seaValue = (s: Stat, t: Stat) => (t.kind === "defense" ? s.attack.anlage : s.attack.see);
    // U-Jagd: Wasserbomben (`uboot`) gegen getauchte U-Boote, zusätzlich zur Salve über Wasser.
    const hunter = (s: Stat) => s.attack.uboot > 0;
    let skip: string | null = null;
    const hasA = pick(tA, A, isShip).length > 0;
    const hasD = pick(tD, D, defSea).length > 0;
    if (!hasA && !hasD) skip = "no_ships";
    else if (!hasA || !hasD) skip = "no_opponent";
    else {
      while (draft.rounds < maxRounds) {
        const sa = pick(tA, A, isShip);
        const sd = pick(tD, D, defSea);
        if (sa.length === 0 || sd.length === 0) break;
        // Ende, wenn niemand mehr jemanden treffen kann (z. B. U-Boote gegen Küstenbatterien, keine U-Jagd).
        const hitValue = (s: Stat, t: Stat) => (isSub(t) ? s.attack.uboot : seaValue(s, t));
        const canHit = (from: typeof sa, to: typeof sa) => from.some(([s]) => to.some(([t]) => hitValue(s, t) > 0));
        if (!canHit(sa, sd) && !canHit(sd, sa)) break;
        draft.rounds++;
        const ra = randomFactor(rng, spread);
        const rd = randomFactor(rng, spread);
        const toD = volley(sa, pick(tD, D, (s) => defSea(s) && surfaceTarget(s)), (s, t) => withMorale(moraleA, seaValue(s, t), s), ra, draft.damage.attacker);
        const toA = volley(sd, pick(tA, A, surfaceTarget), (s) => withMorale(moraleD, s.attack.see, s), rd, draft.damage.defender);
        // Gleicher Zufallsfaktor wie die Salve über Wasser: ohne U-Boote ändert sich nichts am Zufallsstrom.
        const asw = (from: typeof sa, to: typeof sa, morale: number, r: number, dealt: Record<string, number>) =>
          volley(from.filter(([s]) => hunter(s)), to.filter(([s]) => isSub(s)), (s) => withMorale(morale, s.attack.uboot, s), r, dealt);
        const subD = asw(sa, sd, moraleA, ra, draft.damage.attacker);
        const subA = asw(sd, sa, moraleD, rd, draft.damage.defender);
        applyDamage(tD, D, { ...toD, ...subD }, carryD);
        applyDamage(tA, A, { ...toA, ...subA }, carryA);
      }
      if (draft.rounds === 0) skip = "no_targets";
    }
    phases.push(endPhase(draft, A, D, skip, table));
  }

  // ------------------------------------------------------------ 5. Landung
  let landed = false;
  {
    const draft = beginPhase("landung", A, D);
    const isGround = (s: Stat) => s.kind === "ground";
    const defLand = (s: Stat) => s.kind === "ground" || s.id === "bunkerlinie";
    let skip: string | null = null;

    // Truppen über der verbliebenen Transportkapazität gehen verloren (auch ohne Landung).
    let capacity = 0;
    for (const id of table.ids) {
      const n = A[id] ?? 0;
      if (n > 0) capacity += (table.byId[id].troopSpace + (attacker.troopSpaceBonus?.[id] ?? 0)) * n;
    }
    let needed = 0;
    for (const [s, n] of pick(tA, A, isGround)) needed += s.size * n;
    if (needed > capacity) {
      const scale = capacity / needed;
      for (const [s, n] of pick(tA, A, isGround)) A[s.id] = Math.floor(n * scale + 1e-9);
    }

    if (capacity <= 0) skip = "no_landing_ships";
    else if (pick(tA, A, isGround).length === 0) skip = "no_troops";
    else {
      landed = true;
      // Minensperren wirken einmal; Pioniere im Landungsverband halbieren den Schaden.
      let mineDamage = 0;
      for (const [s, n] of pick(tD, D, (x) => x.oneShot > 0)) {
        const d = s.oneShot * n * ((A.pioniere ?? 0) > 0 ? PIONEER_MINE_FACTOR : 1) * modValue(attacker.modifiers, "mineDamage");
        mineDamage += d;
        draft.damage.defender[s.id] = (draft.damage.defender[s.id] ?? 0) + d;
      }
      if (mineDamage > 0) {
        const troops = pick(tA, A, isGround);
        const hpSum = totalHp(troops);
        const dmg: Record<string, number> = {};
        for (const [s, n] of troops) dmg[s.id] = (mineDamage * s.hp * n) / hpSum;
        applyDamage(tA, A, dmg, carryA);
      }
      // Bodenkampf: Truppen treffen Bodentruppen mit "land" und die Bunkerlinie mit "anlage".
      // Küstenbatterien feuern mit "land" auf die gelandeten Truppen, sind aber kein Ziel.
      const groundValue = (s: Stat, t: Stat) => (t.kind === "defense" ? s.attack.anlage : s.attack.land);
      const coastGuns = (s: Stat) => s.kind === "defense" && s.id !== "bunkerlinie" && s.attack.land > 0;
      while (draft.rounds < maxRounds) {
        const ga = pick(tA, A, isGround);
        const gd = pick(tD, D, defLand);
        if (ga.length === 0 || gd.length === 0) break;
        draft.rounds++;
        const ra = randomFactor(rng, spread);
        const rd = randomFactor(rng, spread);
        const shootersD = [...gd, ...pick(tD, D, coastGuns)];
        const toD = volley(ga, gd, (s, t) => withMorale(moraleA, groundValue(s, t), s), ra, draft.damage.attacker);
        const toA = volley(shootersD, ga, (s) => withMorale(moraleD, s.attack.land, s), rd, draft.damage.defender);
        applyDamage(tD, D, toD, carryD);
        applyDamage(tA, A, toA, carryA);
      }
    }
    phases.push(endPhase(draft, A, D, skip, table));
  }

  // ------------------------------------------------------------ Ergebnis
  const attackerTroops = pick(tA, A, (s) => s.kind === "ground").length > 0;
  const defenderHolds = pick(tD, D, (s) => s.kind === "ground" || s.id === "bunkerlinie").length > 0;
  const winner: Side = landed && attackerTroops && !defenderHolds ? "attacker" : "defender";

  const c = balance.combat;
  const isAir = (s: Stat) => s.kind === "fighter" || s.kind === "bomber" || s.kind === "airOther";
  const attackerOutcome = outcome(table, beforeA, A, (s) =>
    isAir(s) ? c.aircraftDamagedShare : s.kind === "ground" && winner === "attacker" ? c.hospitalShareAttacker : 0,
  );
  const defenderOutcome = outcome(table, beforeD, D, (s) =>
    isAir(s)
      ? c.aircraftDamagedShare
      : s.kind === "ground"
        ? c.hospitalShareDefender
        : s.kind === "defense"
          ? c.defenseRepairShare
          : 0,
  );

  // Wracks: Anteil der Stahl- und Elektronikkosten versenkter Schiffe beider Seiten.
  const wreck: ResourceMap = { stahl: 0, elektronik: 0 };
  for (const side of [attackerOutcome, defenderOutcome]) {
    for (const [id, lost] of Object.entries(side.losses)) {
      const s = table.byId[id];
      if ((s.kind !== "ship" && s.kind !== "sub") || lost <= 0) continue;
      wreck.stahl += (s.cost.stahl ?? 0) * lost * c.wreckShare;
      wreck.elektronik += (s.cost.elektronik ?? 0) * lost * c.wreckShare;
    }
  }
  wreck.stahl = Math.floor(wreck.stahl + 1e-9);
  wreck.elektronik = Math.floor(wreck.elektronik + 1e-9);

  let loot: ResourceMap = {};
  for (const r of balance.resources) loot[r] = 0;
  if (winner === "attacker") {
    let cargo = 0;
    for (const id of tA.ids) cargo += tA.byId[id].cargo * (A[id] ?? 0);
    if (attacker.unlimitedCargo) cargo = Infinity;
    loot = computeLoot(defender, cargo, attacker.priorAttacksInWindow ?? 0, balance, attacker.weakTarget ?? false, attacker.modifiers);
  }

  return {
    ok: true,
    report: {
      seed,
      winner,
      airSuperiority,
      landed,
      phases,
      attacker: attackerOutcome,
      defender: defenderOutcome,
      loot,
      wreck,
    },
  };
}
