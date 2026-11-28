// Balance v1.38 (Welle 5 der Abschlussprüfung 0.38): reine Regeln der Engine – Forschung in der Wertung (ST-15),
// Spielerkämpfe zählen Kampf × pvpFactor (ST-16). Ohne Datenbank.
import { test } from "node:test";
import assert from "node:assert/strict";
import { researchCost } from "@tidefront/game-core";
import { balance, reportScore, resValue, unitValue } from "../src/index.ts";
import { researchScoreValue } from "../src/scoring.ts";

test("Forschung zählt zum Ausbau: Kostenwert der erforschten Stufen × researchFactor", () => {
  const f = balance.scoring?.researchFactor ?? 0;
  assert.ok(f > 0 && f <= 1, "researchFactor gesetzt");
  const id = Object.keys(balance.research!.techs)[0];
  const two = resValue(researchCost(id, 0, balance)) + resValue(researchCost(id, 1, balance));
  assert.ok(Math.abs(researchScoreValue({ [id]: 2 }) - two * f) < 1e-9);
  assert.equal(researchScoreValue({}), 0);
  assert.equal(researchScoreValue({ unbekannt: 3 }), 0, "unbekannte Technik zählt nicht");
  // Über der Höchststufe wird nicht weitergezählt.
  const max = balance.research!.techs[id].maxLevel;
  assert.equal(researchScoreValue({ [id]: max + 5 }), researchScoreValue({ [id]: max }));
});

test("Spielerkampf: Kampfpunkte beider Seiten × pvpFactor, Beute und Nester unverändert", () => {
  const pf = balance.scoring?.pvpFactor ?? 1;
  assert.ok(pf > 1, "pvpFactor über 1");
  const loot = { stahl: 500 };
  const r = reportScore({ kind: "ueberfall", attackerPlayerId: 1, defenderPlayerId: 2, al: { korvette: 1 }, dl: { korvette: 3 }, loot });
  assert.ok(Math.abs(r.attacker!.kampf - 3 * unitValue("korvette") * pf) < 1e-9);
  assert.ok(Math.abs(r.defender!.kampf - unitValue("korvette") * pf) < 1e-9);
  assert.equal(r.attacker!.beute, resValue(loot));
  const nest = reportScore({ kind: "ueberfall", nest: true, attackerPlayerId: 1, defenderPlayerId: null, al: {}, dl: { schnellboot: 2 }, loot: null });
  assert.ok(Math.abs(nest.attacker!.kampf - 2 * unitValue("schnellboot") * (balance.scoring?.nestFactor ?? 1)) < 1e-9, "Nest ohne pvpFactor");
  const self = reportScore({ kind: "ueberfall", attackerPlayerId: 1, defenderPlayerId: 1, al: {}, dl: { korvette: 1 }, loot: null });
  assert.equal(self.attacker!.kampf, unitValue("korvette"), "kein Spielerkampf mit sich selbst");
});
