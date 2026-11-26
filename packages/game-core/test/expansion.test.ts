// Mehrere Häfen: Freischaltung, Prüfungen der Gründung, Schutz der Kolonie, Planung „gruendung“/„verlegung“,
// Forschungsamt in der Kolonie gesperrt, Kolonieschiff nach Hafenkommandantur, Veteranen beim Verlegen.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedBases, colonyProtection, createColony, createProtection, foundingBlocker, fuelCost, hexSteps, mergeVeterancy,
  nextUnlockLevel, planMission, protectionStatus, startTraining, startUpgrade, type FoundingCheck,
} from "../src/index.ts";
import { DAY, HOUR, T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const e = balance.expansion!;
const ship = e.colonyShip;

test("Freischaltung: 1 Hafen, ab Kommandozentrale 8 zwei, ab 14 drei, höchstens maxBases", () => {
  assert.equal(allowedBases(makeBase(balance, { buildings: { kommandozentrale: 7 } }), balance), 1);
  assert.equal(allowedBases(makeBase(balance, { buildings: { kommandozentrale: 8 } }), balance), 2);
  assert.equal(allowedBases(makeBase(balance, { buildings: { kommandozentrale: 14 } }), balance), 3);
  assert.equal(allowedBases(makeBase(balance, { buildings: { kommandozentrale: 20 } }), balance), e.maxBases);
  assert.equal(nextUnlockLevel(makeBase(balance, { buildings: { kommandozentrale: 9 } }), balance), 14);
  assert.equal(nextUnlockLevel(makeBase(balance, { buildings: { kommandozentrale: 14 } }), balance), null);
  const { expansion: _, ...off } = balance;
  assert.equal(allowedBases(makeBase(balance, { buildings: { kommandozentrale: 20 } }), off), 1);
});

test("Feldschritte im Gitter (ungerade Zeilen versetzt)", () => {
  assert.equal(hexSteps({ col: 5, row: 5 }, { col: 5, row: 5 }), 0);
  assert.equal(hexSteps({ col: 5, row: 4 }, { col: 6, row: 4 }), 1);
  assert.equal(hexSteps({ col: 5, row: 4 }, { col: 5, row: 5 }), 1); // gerade Zeile: Nachbar unten rechts
  assert.equal(hexSteps({ col: 5, row: 5 }, { col: 6, row: 6 }), 1); // ungerade Zeile: Nachbar unten rechts
  assert.equal(hexSteps({ col: 0, row: 0 }, { col: 0, row: 4 }), 4);
  assert.equal(hexSteps({ col: 0, row: 0 }, { col: 4, row: 0 }), 4);
});

function check(patch: Partial<FoundingCheck> = {}): FoundingCheck {
  return {
    target: { col: 50, row: 50 }, coast: true, homeDistanceKm: 500,
    bases: [{ col: 40, row: 50, own: true }], nests: [], tradePorts: [], fields: [],
    homeState: makeBase(balance, { buildings: { kommandozentrale: 8 } }), ownBases: 1, pendingFoundings: 0,
    units: { [ship]: 1, korvette: 3 }, ...patch,
  };
}

test("Gründung: freies Küstenfeld erlaubt, alle Ablehnungsgründe", () => {
  assert.equal(foundingBlocker(check(), balance), null);
  assert.equal(foundingBlocker(check({ homeState: makeBase(balance, { buildings: { kommandozentrale: 7 } }) }), balance), "command_level");
  assert.equal(foundingBlocker(check({ pendingFoundings: 1 }), balance), "command_level", "laufende Gründung zählt mit");
  const kz20 = makeBase(balance, { buildings: { kommandozentrale: 20 } });
  assert.equal(foundingBlocker(check({ homeState: kz20, ownBases: 2, pendingFoundings: 1 }), balance), "base_limit");
  assert.equal(foundingBlocker(check({ homeState: kz20, ownBases: 2 }), balance), null);
  assert.equal(foundingBlocker(check({ units: { korvette: 3 } }), balance), "colony_ship");
  assert.equal(foundingBlocker(check({ units: { [ship]: 2 } }), balance), "colony_ship", "genau ein Kolonieschiff");
  assert.equal(foundingBlocker(check({ units: undefined }), balance), null, "Ankunft: Schiff prüft der Aufrufer");
  assert.equal(foundingBlocker(check({ coast: false }), balance), "not_coast");
  assert.equal(foundingBlocker(check({ nests: [{ col: 50, row: 50 }] }), balance), "field_taken");
  assert.equal(foundingBlocker(check({ bases: [{ col: 50, row: 50, own: false }] }), balance), "field_taken");
  assert.equal(foundingBlocker(check({ tradePorts: [{ col: 50, row: 50 }] }), balance), "trade_port");
  assert.equal(foundingBlocker(check({ fields: [{ col: 50, row: 50 }] }), balance), "resource_field");
  // Mindestabstand: fremd 4 Felder, eigen 3 Felder.
  assert.equal(foundingBlocker(check({ bases: [{ col: 47, row: 50, own: false }] }), balance), "too_close");
  assert.equal(foundingBlocker(check({ bases: [{ col: 46, row: 50, own: false }] }), balance), null);
  assert.equal(foundingBlocker(check({ bases: [{ col: 48, row: 50, own: true }] }), balance), "too_close_own");
  assert.equal(foundingBlocker(check({ bases: [{ col: 47, row: 50, own: true }] }), balance), null);
  // Reichweite zum Heimathafen.
  assert.equal(foundingBlocker(check({ homeDistanceKm: e.maxRangeKm + 1 }), balance), "too_far");
  assert.equal(foundingBlocker(check({ homeDistanceKm: e.maxRangeKm }), balance), null);
  const { expansion: _, ...off } = balance;
  assert.equal(foundingBlocker(check(), off), "expansion_off");
});

test("Kolonie: Startbestand plus Ladung, Anfängerschutz erbt den Beginn, 24 h Gründungsschutz, Nachtschild übernommen", () => {
  const homeProt = { ...createProtection(T0 - 2 * DAY, 22, 60), nightShieldSuspendedUntilMs: T0 + HOUR, defeatShieldUntilMs: T0 + HOUR };
  const now = T0 + 10 * DAY; // Anfängerschutz des Heimathafens ist vorbei
  const c = createColony(balance, now, { lat: 50, lon: 0 }, homeProt, { stahl: 500 });
  assert.equal(c.resources.stahl, e.startResources.stahl + 500);
  assert.equal(c.resources.proviant, e.startResources.proviant);
  assert.deepEqual(c.colony, { foundedAtMs: now });
  assert.equal(c.protection.createdAtMs, homeProt.createdAtMs);
  assert.equal(c.protection.nightShieldStartHour, 22);
  assert.equal(c.protection.tzOffsetMinutes, 60);
  assert.equal(c.protection.defeatShieldUntilMs, 0);
  assert.equal(protectionStatus(c.protection, now + 23 * HOUR, balance).reason, "gruendungsschutz");
  assert.notEqual(protectionStatus(c.protection, now + 25 * HOUR, balance).reason, "gruendungsschutz");
  // Früh gegründet: Anfängerschutz des Heimathafens läuft weiter (nicht verlängert).
  const early = colonyProtection(createProtection(T0), T0 + DAY, balance);
  assert.equal(protectionStatus(early, T0 + DAY, balance).reason, "anfaengerschutz");
  assert.equal(early.createdAtMs, T0);
  // Vorgemerkte Einstellung wird übernommen.
  const pending = colonyProtection({ ...createProtection(T0), nightShieldNext: { startHour: 1, tzOffsetMinutes: 0, fromMs: T0 + 5 * DAY } }, T0 + DAY, balance);
  assert.equal(pending.nightShieldNext?.startHour, 1);
});

test("Forschungsamt in der Kolonie gesperrt (home_only), im Heimathafen erlaubt", () => {
  const res = { stahl: 1e6, treibstoff: 1e6, elektronik: 1e6, proviant: 1e6 };
  const colony = { ...makeBase(balance, { resources: res }), colony: { foundedAtMs: T0 } };
  const r = startUpgrade(colony, "forschungsamt", T0, balance);
  assert.deepEqual(r, { ok: false, code: "home_only" });
  assert.equal(startUpgrade(colony, "stahlwerk", T0, balance).ok, true);
  assert.equal(startUpgrade(makeBase(balance, { resources: res }), "forschungsamt", T0, balance).ok, true);
});

test("Kolonieschiff: Werft 6 und Hafenkommandantur 6, höchstens 0,2 je Werftstufe", () => {
  const res = { stahl: 1e6, treibstoff: 1e6, elektronik: 1e6, proviant: 1e6 };
  const b = (werft: number, hk: number) => makeBase(balance, { resources: res, buildings: { werft, hafenkommandantur: hk } });
  assert.equal(startTraining(b(5, 6), ship, 1, T0, balance).ok ? "ok" : (startTraining(b(5, 6), ship, 1, T0, balance) as { code: string }).code, "building_level");
  assert.deepEqual(startTraining(b(6, 5), ship, 1, T0, balance), { ok: false, code: "harbor_level" });
  assert.equal(startTraining(b(6, 6), ship, 1, T0, balance).ok, true);
  assert.deepEqual(startTraining(b(6, 6), ship, 2, T0, balance), { ok: false, code: "unit_cap" });
  assert.equal(startTraining(b(10, 6), ship, 2, T0, balance).ok, true);
});

const origin = { lat: 50, lon: 0 };
const target = { lat: 50, lon: 7 };

test("Planung Gründung: genau ein Kolonieschiff, Geleit, Ladung bis Kapazität, Treibstoff Schiff einfach + Geleit doppelt", () => {
  const base = makeBase(balance, { units: { [ship]: 2, korvette: 4 }, buildings: { hafenkommandantur: 6, kommandozentrale: 8 }, resources: { treibstoff: 50_000, stahl: 50_000 } });
  const input = { type: "gruendung", units: { [ship]: 1, korvette: 2 }, origin, target, activeMissions: 0, cargo: { stahl: 2000 } };
  const r = planMission(base, input, T0, balance);
  assert.ok(r.ok, JSON.stringify(r));
  const d = r.mission.distanceKm;
  assert.equal(r.mission.fuelCost, fuelCost({ korvette: 2 }, d, balance) + fuelCost({ [ship]: 1 }, d, balance, undefined, 1));
  assert.equal(r.mission.returnAtMs - T0, 2 * (r.mission.arriveAtMs - T0));
  assert.equal(r.base.unitsAway[ship], 1);
  assert.equal(r.base.resources.stahl, 48_000);
  assert.deepEqual(planMission(base, { ...input, units: { [ship]: 2 } }, T0, balance), { ok: false, code: "colony_ship" });
  assert.deepEqual(planMission(base, { ...input, units: { korvette: 2 } }, T0, balance), { ok: false, code: "colony_ship" });
  const cap = balance.units[ship].cargo!;
  assert.deepEqual(planMission(base, { ...input, units: { [ship]: 1 }, cargo: { stahl: cap + 1 } }, T0, balance), { ok: false, code: "cargo_capacity" });
});

test("Planung Verlegung: nur Hinfahrt, Treibstoff einfach, Ladung erlaubt", () => {
  const base = makeBase(balance, { units: { korvette: 4, zerstoerer: 2 }, resources: { treibstoff: 50_000 } });
  const r = planMission(base, { type: "verlegung", units: { korvette: 4, zerstoerer: 2 }, origin, target, activeMissions: 0 }, T0, balance);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.mission.fuelCost, fuelCost({ korvette: 4, zerstoerer: 2 }, r.mission.distanceKm, balance, undefined, 1));
  assert.equal(r.mission.returnAtMs, r.mission.arriveAtMs);
  assert.deepEqual(planMission(base, { type: "aufklaerung", units: { korvette: 1 }, origin, target, activeMissions: 0, cargo: { stahl: 1 } }, T0, balance), { ok: false, code: "cargo_not_allowed" });
});

test("Verlegung mischt Veteranen gewichtet mit dem Bestand des Ziels", () => {
  const to = makeBase(balance, { units: { korvette: 3 }, unitsAway: { korvette: 1 }, veterancy: { korvette: 10, zerstoerer: 5 } });
  const v = mergeVeterancy(to, { korvette: 30, uboot: 8 }, { korvette: 4, uboot: 2 });
  assert.equal(v?.korvette, (10 * 4 + 30 * 4) / 8);
  assert.equal(v?.zerstoerer, 5, "andere Typen unverändert");
  assert.equal(v?.uboot, 8, "neuer Typ übernimmt die Erfahrung");
  assert.equal(mergeVeterancy(makeBase(balance), undefined, { korvette: 2 }), undefined);
});
