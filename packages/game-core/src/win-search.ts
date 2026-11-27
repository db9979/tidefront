// „Was fehlt zum Sieg?“: günstigste Verbandsmischung zum Richtpreis, die gegen ein Ziel die gewählte Sicherheit
// erreicht – mit allen Anlagen, Modifikatoren, Wetter und der Siegregel wie im echten Kampf. Bestand zuerst (eigene
// Einheiten kosten nichts), was fehlt, wird ausgebildet. Rein und deterministisch (feste Seeds); läuft im Browser in
// einem Web Worker. Ablauf:
//   1. Gierig aufbauen: je Schritt die Einheitenart mit dem besten Zugewinn je Richtpreis (Bodentruppen samt nötiger
//      Landungsschiffe), bis die Suche-Seeds die Sicherheit mit Zuschlag erreichen. Zugewinn über eine glatte Wertung
//      (Sieg = 1, sonst halber Anteil vernichteter Lebenspunkte), damit auch bei 0 % Sieg eine Richtung erkennbar ist.
//   2. Verkleinern: je Art per Halbierungssuche, erst die neuen (teure zuerst), dann die eigenen.
//   3. Prüfen gegen andere Seeds (WIN_VERIFY_RUNS ab WIN_VERIFY_OFFSET); hält es nicht, weiter aufbauen.
// Grenzen: Kommandopunkte je Mission, Truppenplatz auf Landungsschiffen, ausbildbare Arten, Stellplätze.
import { resolveBattle } from "./combat.ts";
import { destroyedDefenderHp, settleBattle, type LootRule, type VictoryRule } from "./battle-victory.ts";
import { hpOfCounts, simSeed, simulateBattle } from "./battle-sim.ts";
import { troopsFit } from "./raid-plan.ts";
import type { AttackerInput, Balance, Counts, DefenderInput, ResourceMap } from "./types.ts";
import type { CombatWeather } from "./weather.ts";

export const WIN_SEARCH_RUNS = 100;
export const WIN_GREEDY_RUNS = 40;
export const WIN_VERIFY_OFFSET = 20000;
export const WIN_VERIFY_RUNS = 300;
const WIN_GROW_OFFSET = 30000;
export const WIN_TARGETS = [0.7, 0.9, 0.99] as const;
const MAX_STEPS = 60;

export interface WinSearchInput {
  /** Kampfbedingungen des Angreifers ohne Einheiten (Modifikatoren, Versorgungsmangel). */
  attacker: Omit<AttackerInput, "units">;
  /** Ziel; mehrere = Spanne (Lauf i gegen defenders[i mod n], Mittel ≥ Ziel). */
  defenders: DefenderInput[];
  weather?: CombatWeather;
  rule?: VictoryRule;
  loot?: LootRule;
  /** Bestand daheim (kostet nichts). */
  have: Counts;
  /** Ausbildbare Arten (Baugebäude und Stufe vorhanden). */
  allowed: string[];
  /** Höchstzahl neuer Einheiten je Art (z. B. Bezahlgrenzen), neue Flugzeuge insgesamt (freie Stellplätze). */
  maxExtra?: Record<string, number>;
  maxExtraAir?: number;
  /** Kommandopunkte je Mission. */
  commandPoints?: number;
  /** Zielsicherheit (0,7 / 0,9 / 0,99). */
  target: number;
  /** Ausbildungszeit je Stück und Art (Sekunden), für die Dauer. */
  secondsEach?: Record<string, number>;
}

export interface WinSearchResult {
  reachable: boolean;
  /** Grund, wenn nicht erreichbar: Kommandopunkte, keine passende Einheitenart, Suche ohne Fortschritt. */
  reason: "command_points" | "no_units" | "no_progress" | null;
  units: Counts;
  extra: Counts;
  extraCost: ResourceMap;
  extraValue: number;
  /** Ausbildungsdauer (Baugebäude parallel, je Gebäude nacheinander). */
  trainSeconds: number;
  /** Siegchance gegen die Prüf-Seeds. */
  winRate: number;
  /** Erwartete Verluste (Ø Stück je Art) und ihr Richtpreis, erwartete Beute (Ø) und ihr Richtpreis. */
  losses: Counts;
  lossValue: number;
  loot: ResourceMap;
  lootValue: number;
  lootUnknown: boolean;
  /** Gerechnete Kämpfe. */
  battles: number;
}

const clean = (c: Counts): Counts => Object.fromEntries(Object.entries(c).filter(([, n]) => n > 0));
const keyOf = (c: Counts) => JSON.stringify(Object.entries(clean(c)).sort());

/** Richtpreis einer Einheit (Kosten × refPrice). */
export function unitRefValue(id: string, b: Balance): number {
  return Object.entries(b.units[id]?.cost ?? {}).reduce((s, [r, v]) => s + (v ?? 0) * (b.market.refPrice[r] ?? 0), 0);
}

/** Kampfwirksame Arten: Angriff oder Truppenplatz, nicht verdeckt. */
export function combatUnitIds(b: Balance): string[] {
  return Object.entries(b.units).filter(([, d]) => !d.covert && ((d.troopSpace ?? 0) > 0 || Object.values(d.attack ?? {}).some((v) => (v as number) > 0))).map(([id]) => id);
}

export function searchWinningForce(input: WinSearchInput, b: Balance, onProgress?: (share: number) => void): WinSearchResult {
  const combat = new Set(combatUnitIds(b));
  const allowed = new Set(input.allowed.filter((id) => combat.has(id)));
  const have = clean(Object.fromEntries(Object.entries(input.have).filter(([id]) => combat.has(id))));
  const types = [...new Set([...allowed, ...Object.keys(have)])];
  const value = (id: string) => unitRefValue(id, b);
  const cpOf = (c: Counts) => Object.entries(c).reduce((s, [id, n]) => s + (b.units[id]?.commandPoints ?? 0) * n, 0);
  const cpMax = input.commandPoints ?? Infinity;
  const extraOf = (c: Counts): Counts => clean(Object.fromEntries(Object.entries(c).map(([id, n]) => [id, n - (have[id] ?? 0)])));
  const extraValue = (c: Counts) => Object.entries(extraOf(c)).reduce((s, [id, n]) => s + value(id) * n, 0);
  const totalValue = (c: Counts) => Object.entries(c).reduce((s, [id, n]) => s + value(id) * n, 0);
  const airExtra = (c: Counts) => Object.entries(extraOf(c)).reduce((s, [id, n]) => s + (b.units[id]?.branch === "luft" ? n : 0), 0);
  const withinLimits = (c: Counts) => {
    if (cpOf(c) > cpMax + 1e-9) return false;
    for (const [id, n] of Object.entries(extraOf(c))) {
      if (!allowed.has(id)) return false;
      if (input.maxExtra?.[id] !== undefined && n > input.maxExtra[id]) return false;
    }
    return input.maxExtraAir === undefined || airExtra(c) <= input.maxExtraAir;
  };
  const rule = input.rule ?? "landung";
  const defs = input.defenders;
  const initialHp = defs.map((d) => hpOfCounts({ ...d.units, ...d.defenses }, b));
  let battles = 0;
  const att = (units: Counts): AttackerInput => ({ ...input.attacker, units: clean(units) });
  const fight = (c: Counts, i: number, offset = 0) => {
    battles++;
    const r = resolveBattle(att(c), defs[i % defs.length], b, simSeed(i, offset), input.weather);
    if (!r.ok) return null;
    return settleBattle(r.report, b, rule);
  };
  const rateMemo = new Map<string, number>();
  const rate = (c: Counts): number => {
    const k = keyOf(c);
    const hit = rateMemo.get(k);
    if (hit !== undefined) return hit;
    let wins = 0;
    for (let i = 0; i < WIN_SEARCH_RUNS; i++) if (fight(c, i)?.destroyed) wins++;
    rateMemo.set(k, wins / WIN_SEARCH_RUNS);
    return wins / WIN_SEARCH_RUNS;
  };
  /** Glatte Wertung: Sieg = 1, sonst die Hälfte des Anteils vernichteter Lebenspunkte. */
  const scoreMemo = new Map<string, number>();
  const score = (c: Counts, runs = WIN_GREEDY_RUNS, offset = 0): number => {
    const k = `${runs}|${offset}|${keyOf(c)}`;
    const hit = scoreMemo.get(k);
    if (hit !== undefined) return hit;
    let s = 0;
    for (let i = 0; i < runs; i++) {
      const r = fight(c, i, offset);
      if (!r) return 0;
      s += r.destroyed ? 1 : 0.5 * Math.min(1, destroyedDefenderHp(r.report, b) / Math.max(1, initialHp[i % defs.length]));
    }
    scoreMemo.set(k, s / runs);
    return s / runs;
  };
  // Höhere Hürde für die Suche, damit die Prüfung mit anderen Seeds hält (0,9 → 0,93; 0,99 → 0,993).
  const goal = Math.min(1, input.target + (1 - input.target) * 0.3);
  const carriers = types.filter((id) => (b.units[id]?.troopSpace ?? 0) > 0).sort((x, y) => value(x) / (b.units[x].troopSpace ?? 1) - value(y) / (b.units[y].troopSpace ?? 1));
  /** Fehlenden Truppenplatz mit Landungsschiffen auffüllen (eigene zuerst, dann das günstigste je Platz). */
  const withCarriers = (c: Counts): Counts | null => {
    const out = { ...c };
    let space = 0, need = 0;
    for (const [id, n] of Object.entries(out)) {
      space += (b.units[id]?.troopSpace ?? 0) * n;
      if (b.units[id]?.branch === "land") need += (b.units[id].size ?? 1) * n;
    }
    for (const id of carriers) {
      if (need <= space) break;
      const per = b.units[id].troopSpace ?? 0;
      const k = Math.ceil((need - space) / per - 1e-9);
      out[id] = (out[id] ?? 0) + k;
      space += k * per;
    }
    return need <= space ? out : null;
  };
  /** Troops über dem Platz fallen im Kampf ohnehin weg: anteilig kürzen (Ausgangsverband aus dem Bestand). */
  const trimTroops = (c: Counts): Counts => {
    let space = 0, need = 0;
    for (const [id, n] of Object.entries(c)) {
      space += (b.units[id]?.troopSpace ?? 0) * n;
      if (b.units[id]?.branch === "land") need += (b.units[id].size ?? 1) * n;
    }
    if (need <= space) return c;
    const f = need > 0 ? space / need : 0;
    return clean(Object.fromEntries(Object.entries(c).map(([id, n]) => [id, b.units[id]?.branch === "land" ? Math.floor(n * f + 1e-9) : n])));
  };

  // Ausgangsverband: der Bestand, falls nötig auf die Kommandopunkte gekürzt.
  let cur = trimTroops({ ...have });
  if (cpOf(cur) > cpMax) {
    const f = cpMax / cpOf(cur);
    cur = trimTroops(clean(Object.fromEntries(Object.entries(cur).map(([id, n]) => [id, Math.floor(n * f + 1e-9)]))));
  }
  let reason: WinSearchResult["reason"] = null;
  if (types.length === 0) reason = "no_units";

  // 1. Gierig aufbauen. Ein Schritt: je Art ein Paket im Wert von `chunkValue` dazu, das wirksamste je Richtpreis.
  const step = (chunkValue: number, runs: number, offset = 0): { best: Counts | null; cpBlocked: boolean } => {
    const curScore = Object.keys(cur).length ? score(cur, runs, offset) : 0;
    let best: { c: Counts; eff: number } | null = null;
    let cpBlocked = false;
    for (const id of types) {
      const ownLeft = Math.max(0, (have[id] ?? 0) - (cur[id] ?? 0));
      const n = ownLeft > 0 ? Math.max(1, Math.min(ownLeft, Math.round(chunkValue / value(id)))) : Math.max(1, Math.round(chunkValue / value(id)));
      let c = { ...cur, [id]: (cur[id] ?? 0) + n };
      if (b.units[id]?.branch === "land") {
        const fit = withCarriers(c);
        if (!fit) continue;
        c = fit;
      }
      if (!withinLimits(c)) {
        if (cpOf(c) > cpMax) cpBlocked = true;
        continue;
      }
      const gain = score(c, runs, offset) - curScore;
      if (gain <= 1e-9) continue;
      const eff = gain / (Math.max(1, extraValue(c) - extraValue(cur)) + 0.01 * (totalValue(c) - totalValue(cur)));
      if (!best || eff > best.eff) best = { c, eff };
    }
    return { best: best?.c ?? null, cpBlocked };
  };
  let steps = 0;
  while (!reason && (Object.keys(cur).length === 0 || rate(cur) < goal)) {
    if (++steps > MAX_STEPS) { reason = "no_progress"; break; }
    onProgress?.(Math.min(0.6, 0.6 * (Object.keys(cur).length ? rate(cur) / goal : 0) + steps * 0.01));
    // Nahe am Ziel reichen wenige Läufe nicht, um Zugewinn zu sehen: dann mit allen Such-Seeds werten.
    const runs = Object.keys(cur).length && score(cur) >= 0.85 ? WIN_SEARCH_RUNS : WIN_GREEDY_RUNS;
    let r: ReturnType<typeof step> = { best: null, cpBlocked: false };
    for (const mult of [1, 2, 4]) { // kein Zugewinn sichtbar: größere Pakete versuchen
      r = step(Math.max(totalValue(cur) * 0.15, 400) * mult, runs);
      if (r.best) break;
    }
    if (!r.best) { reason = r.cpBlocked ? "command_points" : "no_progress"; break; }
    cur = r.best;
  }
  const reachedSearch = !reason;

  // 2. Verkleinern (nur wenn das Ziel erreicht ist): erst neue Einheiten, teure zuerst, dann eigene.
  if (reachedSearch) {
    const ok = (c: Counts) => troopsFit(c, b) && withinLimits(c) && rate(c) >= goal;
    const byValue = Object.keys(cur).sort((x, y) => value(y) - value(x));
    const shrink = (id: string, floor: number) => {
      let lo = floor, hi = cur[id] ?? 0;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (ok({ ...cur, [id]: mid })) hi = mid;
        else lo = mid + 1;
      }
      cur = clean({ ...cur, [id]: hi });
    };
    byValue.forEach((id, i) => { onProgress?.(0.6 + 0.15 * (i / byValue.length)); shrink(id, Math.min(cur[id] ?? 0, have[id] ?? 0)); });
    byValue.forEach((id, i) => { onProgress?.(0.75 + 0.1 * (i / byValue.length)); if (cur[id]) shrink(id, 0); });
    for (const id of carriers) if (cur[id]) shrink(id, 0); // weniger Truppen: Landungsschiffe nachziehen
  }

  // 3. Prüfen gegen andere Seeds; hält es nicht, weiter aufbauen (höchstens ein paar Schritte).
  const verify = (c: Counts) => simulateBattle(att(c), defs, b, { runs: WIN_VERIFY_RUNS, seedOffset: WIN_VERIFY_OFFSET, weather: input.weather, rule, ...(input.loot ? { loot: input.loot } : {}) });
  onProgress?.(0.9);
  let v = verify(cur);
  battles += WIN_VERIFY_RUNS;
  for (let k = 0; reachedSearch && k < 8 && v.ok && v.stats.winRate < input.target; k++) {
    // Mit eigenen Seeds aufbauen (nicht denen der Suche, auf die der Verband schon passt, und nicht den Prüf-Seeds).
    const r = step(Math.max(totalValue(cur) * 0.08, 300), WIN_VERIFY_RUNS, WIN_GROW_OFFSET);
    if (!r.best) break;
    cur = r.best;
    v = verify(cur);
    battles += WIN_VERIFY_RUNS;
  }
  onProgress?.(1);
  const stats = v.ok ? v.stats : null;
  const extra = extraOf(cur);
  const extraCost: ResourceMap = {};
  for (const [id, n] of Object.entries(extra)) for (const [r, q] of Object.entries(b.units[id]?.cost ?? {})) extraCost[r] = (extraCost[r] ?? 0) + (q ?? 0) * n;
  const perBuilding: Record<string, number> = {};
  for (const [id, n] of Object.entries(extra)) {
    const k = b.units[id]?.builtIn ?? "";
    perBuilding[k] = (perBuilding[k] ?? 0) + (input.secondsEach?.[id] ?? b.units[id]?.seconds ?? 0) * n;
  }
  const losses: Counts = stats ? Object.fromEntries(Object.entries(stats.ownLost).map(([id, r]) => [id, Math.round(r.avg * 10) / 10]).filter(([, n]) => (n as number) > 0)) : {};
  const loot: ResourceMap = stats ? Object.fromEntries(Object.entries(stats.loot).map(([r, x]) => [r, Math.round(x.avg)])) : {};
  const priced = (m: Record<string, number>) => Object.entries(m).reduce((s, [r, q]) => s + q * (b.market.refPrice[r] ?? 0), 0);
  const winRate = stats?.winRate ?? 0;
  return {
    reachable: reachedSearch && winRate >= input.target,
    reason: reason ?? (winRate >= input.target ? null : "no_progress"),
    units: clean(cur),
    extra,
    extraCost,
    extraValue: extraValue(cur),
    trainSeconds: Math.max(0, ...Object.values(perBuilding)),
    winRate,
    losses,
    lossValue: Object.entries(losses).reduce((s, [id, n]) => s + value(id) * n, 0),
    loot,
    lootValue: priced(loot),
    lootUnknown: stats?.lootUnknown ?? false,
    battles,
  };
}
