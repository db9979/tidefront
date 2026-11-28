// Weltpolitik Stufe 2 (docs/REGELN-WELTPOLITIK.md): Sturmzeit als vierte Gezeit-Art (Plan über 200 Seeds, Wetterfeld),
// globaler Ruf (Kurve, Sättigung, Zerfall, Deckel, Anfängerschutz), Ächtung (Option, Auszählung, Betroffene) und der
// optische Satellit, der getauchte U-Boote im Streifen sieht.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aechtungTargets, balanceAt, blockadeDays, liveLevelAt, politikLimitMs, politikOf, rufAt, rufEquilibrium, rufLevel, setStormWindows,
  stormAt, stormFromAt, stormWindowsOf, tallySeerat, weatherAt, weltlagePlan, withAechtung, type PolitikPlan, type RufEntry, type SeeratBallot, type SensorCircle,
} from "../src/index.ts";
import { DAY, HOUR, loadBalance, T0 } from "./helpers.ts";

const balance = loadBalance();
const P = politikOf(balance)!;
const R = P.ruf!;
const START = T0;
const END = START + 42 * DAY;

// ---------------------------------------------------------------- Sturmzeit

test("Plan-Würfel mit Sturmzeit über 200 Seeds: 3 Fenster aus 4 Arten, nie doppelt, Kartellfehde nie zuerst, Mindestabstände", () => {
  assert.ok(P.gezeit.kinds.includes("sturmzeit"));
  const limit = politikLimitMs(START, END, balance);
  const seen = new Map<string, number>();
  let minGap = Infinity;
  let earliest = Infinity;
  let latestEnd = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const plan = weltlagePlan(START, END, seed * 104729, balance);
    assert.equal(plan.length, 3, `Seed ${seed}`);
    assert.equal(new Set(plan.map((g) => g.kind)).size, 3, `Seed ${seed}: keine Art doppelt`);
    assert.notEqual(plan[0].kind, "kartellfehde");
    plan.forEach((g, i) => {
      seen.set(g.kind, (seen.get(g.kind) ?? 0) + 1);
      assert.equal(g.endMs - g.startMs, 72 * HOUR);
      assert.ok(g.endMs <= limit + 1 && g.endMs <= START + 31.5 * DAY + 1);
      assert.equal(g.good === null, g.kind !== "rohstoffboom");
      earliest = Math.min(earliest, g.startMs);
      latestEnd = Math.max(latestEnd, g.endMs);
      if (i > 0) minGap = Math.min(minGap, g.startMs - plan[i - 1].endMs);
    });
  }
  assert.ok(minGap >= 5 * DAY - 1, `kleinster Abstand ${minGap / DAY} Tage`);
  assert.ok(earliest >= START + 9.5 * DAY);
  for (const k of ["handelskrise", "rohstoffboom", "kartellfehde", "sturmzeit"]) assert.ok((seen.get(k) ?? 0) >= 100, `${k}: ${seen.get(k)}`);
});

test("Sturmzeit: Sturmschwelle 0,8 → 0,7, Konvoi-Kartellchance halb, Schatzschiff doppelt; systemEveryHours bleibt", () => {
  const plan: PolitikPlan = { windows: [{ id: 1, slot: "gezeit", idx: 1, startMs: START, endMs: START + 3 * DAY, planKind: "sturmzeit", good: null, effect: "sturmzeit", source: "plan" }] };
  const b = balanceAt(balance, plan, START + HOUR);
  assert.ok(Math.abs(b.weather!.stormFrom - 0.7) < 1e-9);
  assert.equal(b.weather!.systemEveryHours, balance.weather!.systemEveryHours);
  assert.ok(Math.abs(b.convoys!.cartelBaseChance - balance.convoys!.cartelBaseChance * 0.5) < 1e-12);
  const we = (x: typeof balance) => (x as unknown as { worldEvents: { kindWeights: Record<string, number> } }).worldEvents.kindWeights;
  assert.equal(we(b).schatzschiff, we(balance).schatzschiff * 2);
  assert.equal(balance.weather!.stormFrom, 0.8, "Grundbalance unverändert");
  const wins = stormWindowsOf(balance, plan);
  assert.equal(wins.length, 1);
  assert.ok(Math.abs(wins[0].stormFrom - 0.7) < 1e-9);
  assert.ok(wins[0].strength > 1);
});

test("Sturmzeit im Wetterfeld: nur im Fenster stärkerer Wind und Schwelle 0,7; außerhalb unverändert", () => {
  const wb = balance.weather!;
  const p = { lat: 50, lon: -20 };
  const at = START + 5 * DAY + 7 * HOUR;
  setStormWindows([]);
  const before = weatherAt(p, at, wb);
  const outside = weatherAt(p, at + 10 * DAY, wb);
  setStormWindows([{ startMs: at - HOUR, endMs: at + HOUR, stormFrom: 0.7, strength: 1.1 }], wb.stormFrom);
  try {
    const inside = weatherAt(p, at, wb);
    assert.ok(inside.wind >= before.wind - 1e-9, "Sturmstärke verstärkt nur");
    assert.equal(inside.storm, inside.wind >= 0.7);
    assert.deepEqual(weatherAt(p, at + 10 * DAY, wb), outside, "außerhalb des Fensters gleich");
    assert.equal(stormFromAt(wb, at), 0.7);
    assert.equal(stormFromAt(wb, at + 2 * HOUR), 0.8);
    assert.ok(stormAt(at));
    // Über viele Orte: mehr Sturm-Felder als ohne Sturmzeit.
    let a = 0;
    let c = 0;
    for (let lat = 36; lat <= 62; lat += 2) for (let lon = -50; lon <= 10; lon += 3) {
      if (weatherAt({ lat, lon }, at, wb).storm) a++;
    }
    setStormWindows([]);
    for (let lat = 36; lat <= 62; lat += 2) for (let lon = -50; lon <= 10; lon += 3) if (weatherAt({ lat, lon }, at, wb).storm) c++;
    assert.ok(a >= c, `Sturmfelder ${a} ≥ ${c}`);
  } finally {
    setStormWindows([]);
  }
});

// ---------------------------------------------------------------- Ruf

const e = (day: number, kind: RufEntry["kind"], extra: Partial<RufEntry> = {}): RufEntry => ({ atMs: START + day * DAY + HOUR, kind, ...extra });

test("Ruf: Sättigung, 5 % Zerfall je Tag, Stufen bei ±30", () => {
  assert.equal(rufLevel(-30, R), "beruechtigt");
  assert.equal(rufLevel(-29.99, R), "unbescholten");
  assert.equal(rufLevel(30, R), "angesehen");
  // Ein Vertrag (+2) an Tag 0: der Zerfall wirkt auf den Stand vom Tagesbeginn – an Tag 2: 2 · 0,95.
  assert.equal(rufAt([e(0, "vertrag")], START, START + DAY + HOUR, R).value, 2);
  const one = rufAt([e(0, "vertrag")], START, START + 2 * DAY + HOUR, R);
  assert.equal(one.value, 1.9);
  assert.equal(one.history.at(-1)!.reason, "zerfall");
  // Sättigung: +5 bei Ruf 50 bringt 2,5.
  const sat = rufAt(Array.from({ length: 12 }, () => e(0, "gesuch")), START, START + HOUR * 2, R);
  assert.ok(sat.value < 60, `gesättigt ${sat.value}`);
  // Gleichgewicht G / (G/100 + 0,05): 2,1 Punkte je Tag → 30 (Angesehen braucht etwa einen KI-Vertrag täglich).
  assert.ok(Math.abs(rufEquilibrium(2.1, R) - 30) < 0.5);
  // Rückweg von −42 ohne Zutun: an Tag 17 sechsmal 5 % Zerfall (der erste wirkt auf den Stand vom Beginn des Tages 11).
  const bad = rufAt([e(10, "schwachziel"), e(10, "schwachziel"), e(10, "schwachziel"), e(10, "schwachziel"), e(10, "strafe")], START, START + 17 * DAY + 2 * HOUR, R, START + 7 * DAY);
  assert.ok(Math.abs(bad.value - (-42 * 0.95 ** 6)) < 0.1, `Rückweg ${bad.value}`);
});

test("Ruf: Deckel je Tag/Woche, Paarbremse der Hilfe, Anfängerschutz nur für Abzüge außer Strafe", () => {
  // Verträge: höchstens +4 je Tag.
  const v = rufAt([e(1, "vertrag"), e(1, "vertrag"), e(1, "vertrag")], START, START + DAY + 3 * HOUR, R);
  assert.equal(v.history.filter((h) => h.reason === "vertrag").length, 2);
  // Handel: +1 je 1 000 Taler, höchstens +3 je Tag.
  const h = rufAt([e(2, "handel", { amount: 600 }), e(2, "handel", { amount: 600 }), e(2, "handel", { amount: 5000 })], START, START + 2 * DAY + 3 * HOUR, R);
  const fees = h.history.filter((x) => x.reason === "handel");
  assert.equal(fees.length, 2);
  assert.ok(Math.abs(fees.reduce((a, x) => a + x.delta, 0) - 3) < 0.2, "3 Punkte (gesättigt kaum weniger)");
  // Hilfe: zweite Hilfe beim selben Gastgeber binnen 7 Tagen halb, bei einem anderen voll.
  const help = rufAt([e(3, "hilfe", { partner: 7 }), e(4, "hilfe", { partner: 7 }), e(4, "hilfe", { partner: 8 })], START, START + 4 * DAY + 3 * HOUR, R);
  const hs = help.history.filter((x) => x.reason === "hilfe").map((x) => x.delta);
  assert.equal(hs[0], 2);
  assert.ok(hs[1] < 1.01 && hs[1] > 0.9, `halb: ${hs[1]}`);
  assert.ok(hs[2] > 1.9);
  // Kartell-Abwehr: höchstens +4 je Woche.
  const k = rufAt(Array.from({ length: 6 }, (_, i) => e(8 + (i % 3) / 10, "kartell")), START, START + 9 * DAY, R);
  assert.equal(k.history.filter((x) => x.reason === "kartell").length, 4);
  // Anfängerschutz: Schwachziel und Blockade zählen nicht, die Vertragsstrafe schon.
  const prot = rufAt([e(1, "schwachziel"), e(1, "blockade"), e(1, "strafe")], START, START + DAY + 3 * HOUR, R, START + 7 * DAY);
  assert.deepEqual(prot.history.map((x) => x.reason), ["strafe"]);
  // Paktbruch −15, Blockade −3 je angefangenem Tag.
  assert.equal(rufAt([e(9, "paktbruch")], START, START + 9 * DAY + 2 * HOUR, R).value, -15);
  assert.deepEqual(blockadeDays(0, 2.5 * DAY, Infinity), [0, DAY, 2 * DAY]);
  assert.deepEqual(blockadeDays(0, 2.5 * DAY, DAY), [0]);
});

// ---------------------------------------------------------------- Ächtung

test("Ächtung: Option nur mit Berüchtigten, trifft nur Berüchtigte, Auszählung mit Quorum und Allianzdeckel", () => {
  const base = ["geleitschutz", "gebuehrensenkung", "gemeinsame_aktion", "ruhig"];
  assert.equal(withAechtung(base, false), base);
  assert.deepEqual(withAechtung(base, true), ["geleitschutz", "gebuehrensenkung", "gemeinsame_aktion", "aechtung", "ruhig"]);
  assert.deepEqual(withAechtung(withAechtung(base, true), true), withAechtung(base, true), "nicht doppelt");
  assert.deepEqual(aechtungTargets([{ playerId: 3, value: -30 }, { playerId: 1, value: -45 }, { playerId: 2, value: -29.9 }, { playerId: 4, value: 40 }], R), [1, 3]);
  const options = withAechtung(base, true);
  const cfg = { ...P.seerat };
  // 4 Menschen ohne Allianz für Ächtung, 1 dagegen; KI-Spieler stimmen nie für die Ächtung.
  const t = tallySeerat({
    options, fallback: "ruhig", activeHumans: 6, cfg,
    ballots: [1, 2, 3, 4].map((id): SeeratBallot => ({ playerId: id, option: "aechtung", allianceId: null })).concat([{ playerId: 5, option: "geleitschutz", allianceId: null }]),
    kis: [{ kiId: 90, name: "Hanse", profile: "haendler" }, { kiId: 91, name: "Wall", profile: "festung" }],
  });
  assert.equal(t.winner, "aechtung");
  assert.ok(t.kiVotes.every((k) => k.option !== "aechtung"));
  // Ohne Quorum (2 von 6 nötig sind 3) gilt die Vorgabe „Ruhige See“.
  const few = tallySeerat({ options, fallback: "ruhig", activeHumans: 6, cfg, ballots: [1, 2].map((id) => ({ playerId: id, option: "aechtung", allianceId: null })), kis: [] });
  assert.equal(few.winner, "ruhig");
  // Eine Allianz allein (4 Stimmen) wird auf 40 % gekürzt und verliert gegen 3 Einzelne.
  const bloc = tallySeerat({
    options, fallback: "ruhig", activeHumans: 7, cfg, kis: [],
    ballots: [1, 2, 3, 4].map((id): SeeratBallot => ({ playerId: id, option: "aechtung", allianceId: 9 })).concat([5, 6, 7].map((id) => ({ playerId: id, option: "geleitschutz", allianceId: null }))),
  });
  assert.equal(bloc.winner, "geleitschutz");
});

// ---------------------------------------------------------------- Optischer Satellit

test("Optischer Satellit sieht getauchte U-Boote im Streifen (Sichtung), nicht unter Wolken; Radarsatellit und Radar nicht", () => {
  const strip = (kind: "satellit" | "radarsatellit", blocked?: (x: number, y: number) => boolean): SensorCircle => ({ kind, x: 0, y: 0, km: 0, strip: { x0: 100, x1: 700, blocked } });
  assert.equal(liveLevelAt([strip("satellit")], 400, 50, "submarine"), "sichtung");
  assert.equal(liveLevelAt([strip("satellit")], 800, 50, "submarine"), null, "außerhalb des Streifens");
  assert.equal(liveLevelAt([strip("satellit", () => true)], 400, 50, "submarine"), null, "unter Wolken");
  assert.equal(liveLevelAt([strip("radarsatellit")], 400, 50, "submarine"), null);
  assert.equal(liveLevelAt([{ kind: "radar", x: 400, y: 50, km: 500 }], 400, 50, "submarine"), null);
  assert.equal(liveLevelAt([{ kind: "sonar", x: 400, y: 50, km: 60 }], 400, 50, "submarine"), "erkennung");
  assert.equal(liveLevelAt([strip("satellit")], 400, 50, "fleet"), "erkennung", "Verbände wie bisher");
});
