// Balance v1.35 (Welle 3): reine Regeln der Engine – Nestwertung (nestFactor), Deckel der Befehle (ordersMaxShare),
// Allianzgröße und Allianzrang, KI-Vergeltung (Takt), Kartellverlust in Stunden Produktion. Ohne Datenbank.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBase, type BattleReport } from "@tidefront/game-core";
import { balance, cappedOrders, makeScore, reportScore, resValue, unitValue } from "../src/index.ts";
import { allianceScore, ALLIANCE_MIN_RANK_SIZE } from "../src/season-alliances.ts";
import { defaultAllianceSize } from "../src/alliance-core.ts";
import { VERGELTUNG_HOURS, vergeltungDue } from "../src/bots-vergeltung.ts";
import { cartelLossHours, cartelLossValue } from "../src/cartel-loss.ts";
import { FESTUNG_MIN_GUARD, FESTUNG_SHIP_GUARD, MIN_HOME_TROOPS, guardShareOf, shipGuardShareOf, strikeForce } from "../src/bots-war.ts";

const nf = balance.scoring!.nestFactor ?? 1;

test("Nestwertung: Kampf und Beute aus Nestern × nestFactor, Spielerkampf und Weltereignis voll", () => {
  assert.ok(nf > 0 && nf < 1);
  const dl = { schnellboot: 4, piratenmiliz: 20 };
  const v = unitValue("schnellboot") * 4 + unitValue("piratenmiliz") * 20;
  const loot = { stahl: 1000, elektronik: 200 };
  const nest = reportScore({ kind: "ueberfall", nest: true, attackerPlayerId: 7, defenderPlayerId: null, al: {}, dl, loot });
  assert.ok(Math.abs(nest.attacker!.kampf - v * nf) < 1e-9);
  assert.ok(Math.abs(nest.attacker!.beute - resValue(loot) * nf) < 1e-9);
  const event = reportScore({ kind: "weltereignis", weKind: "schatzschiff", attackerPlayerId: 7, defenderPlayerId: null, al: {}, dl, loot });
  assert.equal(event.attacker!.kampf, v);
  assert.equal(event.attacker!.beute, resValue(loot));
  const pvp = reportScore({ kind: "ueberfall", nest: false, attackerPlayerId: 7, defenderPlayerId: 8, al: {}, dl: { korvette: 1 }, loot });
  assert.equal(pvp.attacker!.beute, resValue(loot));
});

test("Befehle zählen höchstens ordersMaxShare des Gesamtrangs", () => {
  const share = balance.scoring!.ordersMaxShare!;
  assert.ok(share > 0 && share < 1);
  // 9 500 übrige Punkte → höchstens 500 Befehlspunkte bei 5 %.
  const capped = cappedOrders(10000, 9500);
  assert.equal(capped, Math.floor((share / (1 - share)) * 9500 + 1e-9));
  assert.equal(cappedOrders(10, 9500), 10, "unter dem Deckel unverändert");
  const s = makeScore({ ausbau: 400000, militaer: 300000, kampf: 150000, beute: 100000 }, 5000);
  assert.ok(s.befehle <= share * s.total + 1e-9, `${s.befehle} von ${s.total}`);
  assert.equal(s.total, s.ausbau + s.militaer + s.kampf + s.beute + s.befehle);
});

test("Allianzen: Höchstgröße max(3, ⌈Menschen/2⌉), Rang = Durchschnitt mit Mindestgröße 2", () => {
  assert.equal(defaultAllianceSize(0), 3);
  assert.equal(defaultAllianceSize(4), 3);
  assert.equal(defaultAllianceSize(7), 4);
  assert.equal(defaultAllianceSize(10), 5);
  assert.equal(defaultAllianceSize(1000), 50);
  assert.equal(ALLIANCE_MIN_RANK_SIZE, 2);
  assert.equal(allianceScore(1000, 1), 500, "allein zählt man halb");
  assert.equal(allianceScore(3000, 3), 1000);
  assert.equal(allianceScore(3000, 3, 25), 1025, "Feldpunkte kommen dazu");
});

test("KI-Vergeltung: höchstens einmal je VERGELTUNG_HOURS", () => {
  const t = Date.UTC(2026, 10, 1);
  assert.equal(vergeltungDue({}, t), true);
  assert.equal(vergeltungDue({ revengeAtMs: t }, t + (VERGELTUNG_HOURS - 1) * 3600000), false);
  assert.equal(vergeltungDue({ revengeAtMs: t }, t + VERGELTUNG_HOURS * 3600000), true);
});

test("Kartellverlust: Plünderung plus endgültig verlorene Einheiten, in Stunden Produktion", () => {
  const report = {
    loot: { stahl: 600 },
    defender: { losses: { korvette: 2, schuetzen: 10 }, returned: { schuetzen: 4 } },
  } as unknown as BattleReport;
  const value = cartelLossValue(report);
  assert.ok(Math.abs(value - (resValue({ stahl: 600 }) + 2 * unitValue("korvette") + 6 * unitValue("schuetzen"))) < 1e-9);
  const base = createBase(balance, Date.UTC(2026, 10, 1));
  const h = cartelLossHours(base, report, undefined, base.resUpdatedAt);
  assert.ok(h !== null && h > 0);
});

test("KI: mindestens MIN_HOME_TROOPS Landtruppen bleiben daheim; Festung lässt Schiffe nur zu 20 % zurück", () => {
  const f = strikeForce({ units: { schuetzen: 100, korvette: 10, landungsschiff: 10 } } as never, 0.1);
  assert.equal(f.schuetzen, 100 - MIN_HOME_TROOPS, "Heimwache 10 % wäre 10 – es bleiben 40");
  assert.equal(strikeForce({ units: { schuetzen: 30, landungsschiff: 2 } } as never, 0.1).schuetzen, undefined);
  const fest = { bot: { profile: "festung" } as never, cfg: { homeGuardShare: 0.3 } as never };
  assert.equal(guardShareOf(fest), FESTUNG_MIN_GUARD);
  assert.equal(shipGuardShareOf(fest), FESTUNG_SHIP_GUARD);
  const g = strikeForce({ units: { schuetzen: 200, korvette: 10, landungsschiff: 10 } } as never, guardShareOf(fest), shipGuardShareOf(fest));
  assert.equal(g.korvette, Math.floor(10 * (1 - FESTUNG_SHIP_GUARD)));
  assert.equal(g.schuetzen, Math.floor(200 * (1 - FESTUNG_MIN_GUARD)));
});
