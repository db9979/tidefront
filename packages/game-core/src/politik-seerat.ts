// Weltpolitik: Auszählung einer Seerat-Sitzung (docs/REGELN-WELTPOLITIK.md, Abschnitt 5). Jeder Mensch hat 1 Stimme
// (geheim), alle KI-Spieler zusammen 1 Stimme, nach Spielweise verteilt und offen begründet. Eine Allianz zählt höchstens
// 40 % der abgegebenen Gewichte (Überschuss anteilig gekürzt). Quorum: ⌈N · 0,5⌉ Menschen (N = aktive Menschen), sonst
// gilt die Vorgabe (Plan bzw. Ruhige See). Die Option mit den meisten Gewichten gewinnt; bei Gleichstand Ruhige See.

export interface SeeratBallot {
  playerId: number;
  option: string;
  allianceId: number | null;
}

export interface SeeratKi {
  kiId: number;
  name: string;
  profile: string;
}

export interface SeeratTallyInput {
  options: string[];
  ballots: SeeratBallot[];
  kis: SeeratKi[];
  /** Aktive Menschen (Quorum). */
  activeHumans: number;
  /** Gilt ohne Quorum (fenster: "plan", woche: "ruhig"). */
  fallback: string;
  cfg: { kiTotalWeight: number; allianceMaxShare: number; quorumShare: number; kiPreference: Record<string, string[]> };
}

export interface SeeratTally {
  winner: string;
  /** Gewichte je Option nach Allianzdeckel, einschließlich KI. */
  weights: Record<string, number>;
  /** Abgegebene Menschenstimmen je Option (ohne Namen). */
  humanVotes: Record<string, number>;
  kiVotes: { kiId: number; name: string; profile: string; option: string; weight: number }[];
  quorum: number;
  voted: number;
  quorumMet: boolean;
  /** Gekürzte Allianzen: Gewicht vorher/nachher. */
  capped: { allianceId: number; from: number; to: number }[];
}

/** Stimme eines KI-Spielers: erste verfügbare Option seiner Spielweise, sonst die letzte Option (Ruhige See). */
export function kiChoice(profile: string, options: string[], pref: Record<string, string[]>): string {
  for (const o of pref[profile] ?? []) if (options.includes(o)) return o;
  return options.includes("ruhig") ? "ruhig" : options[options.length - 1];
}

/**
 * Deckel je Allianz: Gewicht w_a ≤ share · T (T = Summe aller Gewichte). Gekürzt wird nur, wenn es Gewichte außerhalb
 * der Allianz gibt; mehrere Allianzen werden wiederholt gekürzt, bis alle unter dem Deckel liegen.
 */
export function capAlliances(groups: Map<number, number>, others: number, share: number): Map<number, number> {
  const out = new Map(groups);
  for (let round = 0; round < 20; round++) {
    let changed = false;
    const total = others + [...out.values()].reduce((s, v) => s + v, 0);
    for (const [a, w] of out) {
      const rest = total - w;
      if (rest <= 1e-12 || w <= share * total + 1e-9) continue;
      out.set(a, (share * rest) / (1 - share));
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return out;
}

export function tallySeerat(i: SeeratTallyInput): SeeratTally {
  const humanVotes: Record<string, number> = {};
  const weights: Record<string, number> = Object.fromEntries(i.options.map((o) => [o, 0]));
  const valid = i.ballots.filter((b) => i.options.includes(b.option));
  for (const b of valid) humanVotes[b.option] = (humanVotes[b.option] ?? 0) + 1;

  const kiVotes = i.kis.map((k) => ({ kiId: k.kiId, name: k.name, profile: k.profile, option: kiChoice(k.profile, i.options, i.cfg.kiPreference), weight: i.kis.length > 0 ? i.cfg.kiTotalWeight / i.kis.length : 0 }));
  const kiWeight = kiVotes.reduce((s, k) => s + k.weight, 0);

  // Allianzdeckel: Gewicht je Allianz, Einzelspieler und KI zählen als „außerhalb“.
  const groups = new Map<number, number>();
  for (const b of valid) if (b.allianceId !== null) groups.set(b.allianceId, (groups.get(b.allianceId) ?? 0) + 1);
  const loners = valid.filter((b) => b.allianceId === null).length;
  const capped = capAlliances(groups, loners + kiWeight, i.cfg.allianceMaxShare);
  for (const b of valid) {
    const w = b.allianceId === null ? 1 : (capped.get(b.allianceId)! / groups.get(b.allianceId)!);
    weights[b.option] += w;
  }
  for (const k of kiVotes) weights[k.option] = (weights[k.option] ?? 0) + k.weight;

  const quorum = Math.max(1, Math.ceil(i.activeHumans * i.cfg.quorumShare));
  const quorumMet = valid.length >= quorum;
  let winner = i.fallback;
  if (quorumMet) {
    const best = Math.max(...i.options.map((o) => weights[o] ?? 0));
    const top = i.options.filter((o) => Math.abs((weights[o] ?? 0) - best) < 1e-9);
    winner = top.length === 1 ? top[0] : i.options.includes("ruhig") ? "ruhig" : i.fallback;
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    winner,
    weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, round(v)])),
    humanVotes,
    kiVotes: kiVotes.map((k) => ({ ...k, weight: round(k.weight) })),
    quorum,
    voted: valid.length,
    quorumMet,
    capped: [...groups].filter(([a, w]) => Math.abs(capped.get(a)! - w) > 1e-9).map(([a, w]) => ({ allianceId: a, from: w, to: round(capped.get(a)!) })),
  };
}
