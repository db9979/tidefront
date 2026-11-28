// Weltpolitik (docs/REGELN-WELTPOLITIK.md): wirksame Balance, Gezeit-Plan über 200 Seeds, Seerat-Sitzungen, Ansehen-Kurve,
// Auszählung mit Allianzdeckel, Lohn und Liefermenge der Gesuche.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ansehenAt, ansehenEffects, ansehenEquilibrium, balanceAt, capAlliances, cartelChance, finaleSchedule, gesuchQty, gesuchReward, isNotorious,
  nextChangeMs, planSeed, politikLimitMs, politikOf, seeratPlan, tallySeerat, weeklyEffect, weltlagePlan, type AnsehenEntry, type PolitikPlan,
  type PolitikWindow,
} from "../src/index.ts";
import { DAY, HOUR, loadBalance, T0 } from "./helpers.ts";

const balance = loadBalance();
const P = politikOf(balance)!;
const START = T0;
const END = START + 42 * DAY;

function win(id: number, effect: PolitikWindow["effect"], startMs: number, endMs: number, good: string | null = null): PolitikWindow {
  return { id, slot: "gezeit", idx: id, startMs, endMs, planKind: null, good, effect, source: "plan" };
}

// ---------------------------------------------------------------- Fundament

test("balanceAt: ohne wirkendes Fenster dieselbe Referenz, Grenzen Beginn eingeschlossen/Ende ausgeschlossen", () => {
  const plan: PolitikPlan = { windows: [win(1, "handelskrise", START + 10 * DAY, START + 13 * DAY)] };
  assert.equal(balanceAt(balance, plan, START), balance);
  assert.equal(balanceAt(balance, null, START), balance);
  assert.equal(balanceAt(balance, plan, START + 13 * DAY), balance);
  const b = balanceAt(balance, plan, START + 10 * DAY);
  assert.notEqual(b, balance);
  assert.equal(balanceAt(balance, plan, START + 11 * DAY), b, "zwischengespeichert je wirkender Fenstermenge");
  assert.equal(balance.market.fee, 0.04, "Grundbalance bleibt unverändert");
  assert.equal(nextChangeMs(plan, START), START + 10 * DAY);
  assert.equal(nextChangeMs(plan, START + 11 * DAY), START + 13 * DAY);
  assert.equal(nextChangeMs(plan, START + 14 * DAY), null);
});

test("Handelskrise: Gebühr 6 %, Tageslimit 15 %, KI-Vertragsbonus +2 Pp", () => {
  const plan: PolitikPlan = { windows: [win(1, "handelskrise", START, START + 3 * DAY)] };
  const b = balanceAt(balance, plan, START + HOUR);
  assert.ok(Math.abs(b.market.fee - 0.06) < 1e-12);
  assert.ok(Math.abs(b.market.dailyLimitShareOfStorage - 0.15) < 1e-12);
  for (const [k, p] of Object.entries(b.market.contracts!.ki.profiles)) {
    assert.ok(Math.abs((p.bonus ?? 0) - ((balance.market.contracts!.ki.profiles[k].bonus ?? 0) + 0.02)) < 1e-12, k);
  }
});

test("Kartellfehde: Überfallintervall 18 → 36 h, Feld-Kartellchance halbiert, Großflotte-Gewicht ×3", () => {
  const plan: PolitikPlan = { windows: [win(1, "kartellfehde", START, START + 3 * DAY)] };
  const b = balanceAt(balance, plan, START);
  assert.equal(b.pirates.raidIntervalHours, balance.pirates.raidIntervalHours * 2);
  const f = (x: typeof balance) => (x as unknown as { fields: { cartelRaidChance: number } }).fields.cartelRaidChance;
  assert.ok(Math.abs(f(b) - f(balance) / 2) < 1e-12);
  const w = (x: typeof balance) => (x as unknown as { worldEvents: { kindWeights: Record<string, number> } }).worldEvents.kindWeights;
  assert.equal(w(b).grossflotte, w(balance).grossflotte * 3);
});

test("Geleitschutz halbiert die Kartellchance der Konvois (auch die Obergrenze)", () => {
  const plan: PolitikPlan = { windows: [{ ...win(1, "geleitschutz", START, START + 2 * DAY), slot: "woche" }] };
  const b = balanceAt(balance, plan, START);
  for (const [km, value, market] of [[500, 10_000, false], [2000, 200_000, false], [800, 30_000, true]] as const) {
    const base = cartelChance(km, value, balance, market);
    assert.ok(base > 0);
    assert.ok(Math.abs(cartelChance(km, value, b, market) - base / 2) < 1e-9, `${km} km, ${value}`);
  }
});

test("Klemme: gestapelte Wirkungen bleiben zwischen 0,5× und 1,75× des Grundwerts", () => {
  const plan: PolitikPlan = { windows: [win(1, "handelskrise", START, START + DAY), win(2, "handelskrise", START, START + DAY), { ...win(3, "handelskrise", START, START + DAY), slot: "woche" }] };
  const b = balanceAt(balance, plan, START);
  assert.ok(Math.abs(b.market.fee - 0.04 * P.clamp.max) < 1e-12);
  assert.ok(b.market.dailyLimitShareOfStorage >= 0.2 * P.clamp.min - 1e-12);
});

test("Rohstoffboom: Produktion und Feldertrag des Guts +20 % (über politikNow), Feldertrag in der Balance", () => {
  const plan: PolitikPlan = { windows: [win(1, "rohstoffboom", START, START + DAY, "treibstoff")] };
  const b = balanceAt(balance, plan, START);
  assert.deepEqual(b.politikNow!.production, { treibstoff: 1.2 });
  const kinds = (x: typeof balance) => (x as unknown as { fields: { kinds: Record<string, { resource: string; yieldPerHour: number[] }> } }).fields.kinds;
  for (const [k, def] of Object.entries(kinds(b))) {
    const f = def.resource === "treibstoff" ? 1.2 : 1;
    def.yieldPerHour.forEach((y, i) => assert.ok(Math.abs(y - kinds(balance)[k].yieldPerHour[i] * f) < 1e-9, k));
  }
});

// ---------------------------------------------------------------- Gezeit-Plan

test("Gezeit-Termine über 200 Seeds: 3 Fenster, Tag 10/19/28 ± 0,5, Abstand ≥ 5 Tage, Ende ≤ 31,5, Arten nie doppelt, Kartellfehde nie zuerst", () => {
  const limit = politikLimitMs(START, END, balance);
  assert.equal(limit, finaleSchedule(START, END, balance).announceMs - 48 * HOUR);
  const firstKinds = new Set<string>();
  const goods = new Set<string>();
  let minGap = Infinity;
  for (let seed = 1; seed <= 200; seed++) {
    const plan = weltlagePlan(START, END, seed * 7919, balance);
    assert.equal(plan.length, 3, `Seed ${seed}`);
    assert.deepEqual(plan, weltlagePlan(START, END, seed * 7919, balance), "deterministisch");
    assert.equal(new Set(plan.map((g) => g.kind)).size, 3);
    assert.notEqual(plan[0].kind, "kartellfehde");
    firstKinds.add(plan[0].kind);
    plan.forEach((g, i) => {
      const day = (g.startMs - START) / DAY;
      assert.ok(Math.abs(day - [10, 19, 28][i]) <= 0.5 + 1e-9, `Seed ${seed}: Fenster ${i + 1} an Tag ${day}`);
      assert.equal(g.endMs - g.startMs, 72 * HOUR);
      assert.ok(g.endMs <= START + 31.5 * DAY + 1 && g.endMs <= limit);
      if (g.kind === "rohstoffboom") {
        assert.ok(g.good && g.good !== "stahl");
        goods.add(g.good);
      } else assert.equal(g.good, null);
      if (i > 0) minGap = Math.min(minGap, g.startMs - plan[i - 1].endMs);
    });
  }
  assert.ok(minGap >= 5 * DAY - 1, `kleinster Abstand ${minGap / DAY} Tage`);
  assert.deepEqual([...firstKinds].sort(), ["handelskrise", "rohstoffboom", "sturmzeit"], "Stufe 2: Sturmzeit im Plan-Würfel");
  assert.equal(goods.size, 3, "alle drei Boom-Güter kommen vor");
});

test("Gezeit bei kürzerer Saison: proportional umgerechnet, nichts nach der Finale-Sperre", () => {
  const end = START + 21 * DAY;
  for (let seed = 1; seed <= 50; seed++) {
    const plan = weltlagePlan(START, end, seed, balance);
    for (const g of plan) assert.ok(g.endMs <= politikLimitMs(START, end, balance) + 1);
    assert.ok(plan.length >= 2);
  }
});

test("Seerat-Plan: Sitzung 36 h bis 12 h vor jedem Fenster, Wochensitzungen Tag 7/14/21/28, Wochenwirkung nie zugleich mit einer Gezeit", () => {
  const limit = politikLimitMs(START, END, balance);
  for (let seed = 1; seed <= 200; seed++) {
    const gezeit = weltlagePlan(START, END, seed, balance);
    const s = seeratPlan(START, END, gezeit, seed, balance);
    const fenster = s.filter((x) => x.kind === "fenster");
    const woche = s.filter((x) => x.kind === "woche");
    assert.equal(fenster.length, 3);
    for (const f of fenster) {
      const g = gezeit.find((x) => x.idx === f.idx)!;
      assert.equal(g.startMs - f.opensMs, 36 * HOUR);
      assert.equal(g.startMs - f.closesMs, 12 * HOUR);
      assert.equal(f.options[0], "plan");
      assert.equal(f.options.at(-1), "ruhig");
      assert.equal(f.options.length, 3);
    }
    assert.equal(woche.length, 4, `Seed ${seed}`);
    woche.forEach((w, i) => {
      assert.equal(w.opensMs, START + [7, 14, 21, 28][i] * DAY);
      assert.equal(w.closesMs - w.opensMs, 24 * HOUR);
      assert.ok(w.effectStartMs >= w.closesMs);
      assert.ok(w.effectEndMs - w.effectStartMs >= 12 * HOUR && w.effectEndMs - w.effectStartMs <= 48 * HOUR);
      assert.ok(w.effectEndMs <= limit + 1);
      for (const g of gezeit) assert.ok(w.effectEndMs <= g.startMs || w.effectStartMs >= g.endMs, `Seed ${seed}: Woche ${i + 1} überlappt Gezeit ${g.idx}`);
      assert.deepEqual(w.options, [...P.seerat.weeklyCatalog, "ruhig"]);
    });
  }
});

test("weeklyEffect: verschiebt hinter eine laufende Gezeit, kürzt vor einer beginnenden, entfällt wenn zu kurz", () => {
  const g = [{ startMs: 100, endMs: 200 }];
  assert.deepEqual(weeklyEffect(150, 50, g, 10), { startMs: 200, endMs: 250 });
  assert.deepEqual(weeklyEffect(50, 100, g, 10), { startMs: 50, endMs: 100 });
  assert.equal(weeklyEffect(95, 100, g, 10), null);
  assert.deepEqual(weeklyEffect(300, 50, g, 10), { startMs: 300, endMs: 350 });
});

test("planSeed: fest je Saison", () => {
  assert.equal(planSeed(3, START), planSeed(3, START));
  assert.notEqual(planSeed(3, START), planSeed(4, START));
});

// ---------------------------------------------------------------- Ansehen

const A = P.ansehen;
const at = (day: number, h = 12) => START + day * DAY + h * HOUR;

test("Ansehen: Pluspunkte sättigen, Abzüge voll, 5 % Zerfall je Tagesgrenze", () => {
  const e: AnsehenEntry[] = [{ atMs: at(0), kind: "gesuch" }];
  assert.equal(ansehenAt(e, START, at(0, 13), A).value, 5);
  // Zerfall an der Tagesgrenze: 5 % des Stands vom Beginn des abgelaufenen Tages (R′ = R + G·(1 − R/100) − 0,05·R).
  assert.equal(ansehenAt(e, START, at(1), A).value, 5);
  assert.equal(ansehenAt(e, START, at(2), A).value, 4.75);
  const two = ansehenAt([...e, { atMs: at(0, 14), kind: "gesuch" }], START, at(0, 15), A);
  assert.equal(two.value, Math.round((5 + 5 * (1 - 5 / 100)) * 100) / 100, "zweites Gesuch gesättigt: 5 · 0,95");
  const raid = ansehenAt([...e, { atMs: at(0, 14), kind: "ueberfall" }], START, at(0, 15), A);
  assert.equal(raid.value, -25);
  assert.equal(raid.level, "bekannt");
  assert.equal(raid.lastRaidMs, at(0, 14));
  const neg = ansehenAt([{ atMs: at(0), kind: "ueberfall" }, { atMs: at(0, 13), kind: "strafe" }], START, at(0, 14), A);
  assert.equal(neg.value, -40);
  assert.equal(neg.level, "misstraut");
  assert.ok(ansehenAt([{ atMs: at(0), kind: "ueberfall" }, { atMs: at(0, 13), kind: "strafe" }], START, at(20), A).value > -20, "Zerfall zieht zurück zu 0");
});

test("Ansehen: Liefervertrag +2, höchstens +4 je Tag", () => {
  const e: AnsehenEntry[] = [0, 1, 2, 3].map((i) => ({ atMs: at(2, 8 + i), kind: "vertrag" as const }));
  const r = ansehenAt(e, START, at(2, 20), A);
  assert.equal(r.history.filter((h) => h.reason === "vertrag").length, 2);
  assert.ok(r.value > 3.9 && r.value <= 4);
});

test("Ansehen: Paktbruch −15 einmal bei Überfall ≤ 48 h nach Erlöschen des gekündigten Pakts", () => {
  const end = at(3);
  const within = ansehenAt([{ atMs: end, kind: "pakt_ende" }, { atMs: end + 47 * HOUR, kind: "ueberfall" }], START, end + 48 * HOUR, A);
  assert.equal(within.history.filter((h) => h.reason === "paktbruch").length, 1);
  assert.equal(within.value, -45);
  const later = ansehenAt([{ atMs: end, kind: "pakt_ende" }, { atMs: end + 49 * HOUR, kind: "ueberfall" }], START, end + 50 * HOUR, A);
  assert.equal(later.history.filter((h) => h.reason === "paktbruch").length, 0);
});

test("Ansehen: Gleichgewicht und Weg zu „Vertraut“ (täglich 1 Gesuch + 2 Verträge)", () => {
  const eq = ansehenEquilibrium(9, A);
  assert.ok(eq > 60 && eq < 70, String(eq));
  const e: AnsehenEntry[] = [];
  for (let d = 0; d < 14; d++) e.push({ atMs: at(d, 9), kind: "gesuch" }, { atMs: at(d, 10), kind: "vertrag" }, { atMs: at(d, 11), kind: "vertrag" });
  const r = ansehenAt(e, START, at(14), A);
  const vertrautAm = r.history.find((h) => h.value >= A.vertrautFrom);
  assert.ok(vertrautAm && (vertrautAm.atMs - START) / DAY < 5, "nach wenigen Tagen Vertraut");
  assert.equal(r.level, "vertraut");
  assert.ok(r.value < eq + 1);
  assert.ok(r.history.some((h) => h.reason === "zerfall"));
});

test("Ansehen: Stufen wirken nur auf KI-Verträge, Gesuche und Pakt", () => {
  assert.deepEqual(ansehenEffects("misstraut", A), { bonusDelta: -0.02, quotaShare: 0.15, gesuche: false, pakt: false });
  assert.deepEqual(ansehenEffects("bekannt", A), { bonusDelta: 0, quotaShare: 0.25, gesuche: true, pakt: false });
  assert.deepEqual(ansehenEffects("vertraut", A), { bonusDelta: 0.02, quotaShare: 0.35, gesuche: true, pakt: true });
  assert.equal(isNotorious([-30, -30, -30], 3, A), true);
  assert.equal(isNotorious([-60, 0, 0], 3, A), false);
  assert.equal(isNotorious([-60, -30], 3, A), true, "ohne Buchung zählt 0, aber KI ohne Zeile fehlt im Mittel nicht");
  assert.equal(isNotorious([], 0, A), false);
});

// ---------------------------------------------------------------- Seerat

const cfg = P.seerat;
const kis = [{ kiId: 90, name: "Hanse", profile: "haendler" }, { kiId: 91, name: "Fels", profile: "festung" }, { kiId: 92, name: "Rotbart", profile: "freibeuter" }];

test("Abstimmung: 1 Stimme je Mensch, KI zusammen 1 nach Spielweise, Gleichstand → Ruhige See", () => {
  const options = ["plan", "handelsfrieden", "ruhig"];
  const t = tallySeerat({
    options, kis, activeHumans: 4, fallback: "plan", cfg,
    ballots: [{ playerId: 1, option: "plan", allianceId: null }, { playerId: 2, option: "handelsfrieden", allianceId: null }, { playerId: 3, option: "plan", allianceId: null }],
  });
  assert.equal(t.quorumMet, true);
  assert.equal(t.quorum, 2);
  const kiSum = t.kiVotes.reduce((s, k) => s + k.weight, 0);
  assert.ok(Math.abs(kiSum - 1) < 1e-2);
  assert.equal(t.kiVotes.find((k) => k.profile === "haendler")!.option, "handelsfrieden");
  assert.equal(t.kiVotes.find((k) => k.profile === "freibeuter")!.option, "plan");
  assert.equal(t.kiVotes.find((k) => k.profile === "festung")!.option, "ruhig");
  assert.equal(t.winner, "plan");
  assert.deepEqual(t.humanVotes, { plan: 2, handelsfrieden: 1 });

  const tie = tallySeerat({ options, kis: [], activeHumans: 2, fallback: "plan", cfg, ballots: [{ playerId: 1, option: "plan", allianceId: null }, { playerId: 2, option: "handelsfrieden", allianceId: null }] });
  assert.equal(tie.winner, "ruhig");
});

test("Abstimmung: ohne Quorum gilt die Vorgabe; ungültige Optionen zählen nicht", () => {
  const t = tallySeerat({ options: ["plan", "geleitschutz", "ruhig"], kis, activeHumans: 10, fallback: "plan", cfg, ballots: [
    { playerId: 1, option: "geleitschutz", allianceId: null }, { playerId: 2, option: "geleitschutz", allianceId: null }, { playerId: 3, option: "bogus", allianceId: null },
  ] });
  assert.equal(t.quorum, 5);
  assert.equal(t.voted, 2);
  assert.equal(t.quorumMet, false);
  assert.equal(t.winner, "plan");
  const w = tallySeerat({ options: ["geleitschutz", "ruhig"], kis: [], activeHumans: 1, fallback: "ruhig", cfg, ballots: [{ playerId: 1, option: "geleitschutz", allianceId: null }] });
  assert.equal(w.winner, "geleitschutz", "Seerat tagt immer, auch mit einem Menschen");
});

test("Allianzdeckel: eine Allianz zählt höchstens 40 % der abgegebenen Gewichte", () => {
  // 6 Mitglieder einer Allianz gegen 3 Einzelne + KI (1): ohne Deckel 6 : 4.
  const ballots = [
    ...[1, 2, 3, 4, 5, 6].map((id) => ({ playerId: id, option: "handelsfrieden", allianceId: 7 })),
    ...[10, 11, 12].map((id) => ({ playerId: id, option: "plan", allianceId: null })),
  ];
  const t = tallySeerat({ options: ["plan", "handelsfrieden", "ruhig"], kis: [{ kiId: 90, name: "Rotbart", profile: "freibeuter" }], activeHumans: 9, fallback: "plan", cfg, ballots });
  const total = Object.values(t.weights).reduce((s, v) => s + v, 0);
  assert.ok(t.weights.handelsfrieden / total <= 0.4 + 1e-3, JSON.stringify(t.weights));
  assert.equal(t.capped.length, 1);
  assert.equal(t.capped[0].from, 6);
  assert.equal(t.winner, "plan");
  // Zwei große Allianzen: beide gedeckelt, keine über 40 %.
  const two = capAlliances(new Map([[1, 10], [2, 8]]), 2, 0.4);
  const sum = [...two.values()].reduce((s, v) => s + v, 0) + 2;
  for (const v of two.values()) assert.ok(v / sum <= 0.4 + 1e-9, `${v}/${sum}`);
  // Ohne Gewichte außerhalb wird nicht gekürzt (nichts, wogegen gedeckelt werden könnte).
  assert.deepEqual([...capAlliances(new Map([[1, 5]]), 0, 0.4)], [[1, 5]]);
});

// ---------------------------------------------------------------- Gesuche

test("Gesuch: Lohn 3 h Produktion aus dem KI-Lager über der Reserve, sonst kein Angebot; Menge in Schritten", () => {
  const g = P.gesuche;
  const ref = balance.market.refPrice;
  const per = { stahl: 400, treibstoff: 200 };
  const full = gesuchReward(per, { stahl: 100_000, treibstoff: 100_000 }, 100_000, ref, g)!;
  assert.deepEqual(full.reward, { stahl: 1200, treibstoff: 600 });
  assert.equal(full.value, full.wanted);
  const partial = gesuchReward(per, { stahl: 20_000 + 1200, treibstoff: 20_000 }, 100_000, ref, g);
  assert.ok(partial === null || partial.value >= g.minRewardShare * full.wanted);
  assert.equal(gesuchReward(per, { stahl: 20_000, treibstoff: 20_000 }, 100_000, ref, g), null, "Lager auf Reserve: kein Angebot");
  assert.equal(gesuchQty(300, g, 100, 50, 10_000), 600);
  assert.equal(gesuchQty(10, g, 100, 50, 10_000), 100);
  assert.equal(gesuchQty(300, g, 100, 50, 80), null);
});
