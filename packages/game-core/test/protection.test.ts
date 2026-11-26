import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDefeatShield,
  createProtection,
  isBeginnerProtected,
  isDefeatShieldActive,
  isNightShieldActive,
  nightShieldWindow,
  protectionStatus,
  suspendNightShield,
} from "../src/index.ts";
import { DAY, HOUR, loadBalance } from "./helpers.ts";

const balance = loadBalance();
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 2, day, hour, minute);
// Gründung weit in der Vergangenheit: kein Anfängerschutz.
const old = (startHour: number | null, tz = 0) => createProtection(at(1, 0) - 100 * DAY, startHour, tz);

test("Nachtschild über Mitternacht (Start 22 Uhr, 8 Stunden)", () => {
  const p = old(22);
  assert.equal(isNightShieldActive(p, at(10, 21, 59), balance), false);
  assert.equal(isNightShieldActive(p, at(10, 22, 0), balance), true);
  assert.equal(isNightShieldActive(p, at(10, 23, 30), balance), true);
  assert.equal(isNightShieldActive(p, at(11, 0, 0), balance), true);
  assert.equal(isNightShieldActive(p, at(11, 5, 59), balance), true);
  assert.equal(isNightShieldActive(p, at(11, 6, 0), balance), false);
  assert.equal(isNightShieldActive(p, at(11, 12, 0), balance), false);
});

test("Nachtschild ohne Mitternacht (Start 1 Uhr) und ohne gewählte Stunde", () => {
  const p = old(1);
  assert.equal(isNightShieldActive(p, at(10, 0, 59), balance), false);
  assert.equal(isNightShieldActive(p, at(10, 1, 0), balance), true);
  assert.equal(isNightShieldActive(p, at(10, 8, 59), balance), true);
  assert.equal(isNightShieldActive(p, at(10, 9, 0), balance), false);
  assert.equal(isNightShieldActive(old(null), at(10, 3), balance), false);
  assert.equal(nightShieldWindow(old(null), at(10, 3), balance), null);
});

test("Startstunde gilt in Ortszeit (tzOffsetMinutes)", () => {
  // 22 Uhr MEZ = 21 Uhr UTC
  const p = old(22, 60);
  assert.equal(isNightShieldActive(p, at(10, 20, 59), balance), false);
  assert.equal(isNightShieldActive(p, at(10, 21, 0), balance), true);
  assert.equal(isNightShieldActive(p, at(11, 4, 59), balance), true);
  assert.equal(isNightShieldActive(p, at(11, 5, 0), balance), false);
});

test("Fenster: laufendes oder nächstes", () => {
  const p = old(22);
  assert.deepEqual(nightShieldWindow(p, at(11, 3), balance), { startMs: at(10, 22), endMs: at(11, 6) });
  assert.deepEqual(nightShieldWindow(p, at(11, 6), balance), { startMs: at(11, 22), endMs: at(12, 6) });
  assert.deepEqual(nightShieldWindow(p, at(11, 15), balance), { startMs: at(11, 22), endMs: at(12, 6) });
});

test("eigener Angriff hebt den Schild für diese Nacht auf, nicht für die nächste", () => {
  const p = old(22);
  // Angriff am Abend vor Schildbeginn
  const evening = suspendNightShield(p, at(10, 20), balance);
  assert.equal(isNightShieldActive(evening, at(10, 23), balance), false);
  assert.equal(isNightShieldActive(evening, at(11, 5), balance), false);
  assert.equal(isNightShieldActive(evening, at(11, 23), balance), true);
  // Angriff während des Schilds
  const night = suspendNightShield(p, at(11, 1), balance);
  assert.equal(isNightShieldActive(night, at(11, 2), balance), false);
  assert.equal(isNightShieldActive(night, at(11, 22), balance), true);
  // Eingabe unverändert
  assert.equal(p.nightShieldSuspendedUntilMs, 0);
});

test("Anfängerschutz für beginnerDays Tage", () => {
  const p = createProtection(at(1, 0));
  assert.equal(isBeginnerProtected(p, at(1, 0), balance), true);
  assert.equal(isBeginnerProtected(p, at(7, 23, 59), balance), true);
  assert.equal(isBeginnerProtected(p, at(8, 0), balance), false);
});

test("Schutz nach Niederlage für afterDefeatShieldHours", () => {
  const p = old(null);
  const shielded = applyDefeatShield(p, at(10, 12), balance);
  assert.equal(isDefeatShieldActive(shielded, at(10, 19, 59)), true);
  assert.equal(isDefeatShieldActive(shielded, at(10, 20)), false);
  assert.equal(isDefeatShieldActive(p, at(10, 13)), false);
  assert.equal(shielded.defeatShieldUntilMs, at(10, 12) + 8 * HOUR);
});

test("Gesamtstatus nennt den Grund", () => {
  assert.deepEqual(protectionStatus(createProtection(at(9, 0)), at(10, 12), balance), {
    protected: true,
    reason: "anfaengerschutz",
  });
  assert.deepEqual(protectionStatus(applyDefeatShield(old(null), at(10, 11), balance), at(10, 12), balance), {
    protected: true,
    reason: "niederlage",
  });
  assert.deepEqual(protectionStatus(old(22), at(10, 23), balance), { protected: true, reason: "nachtschild" });
  assert.deepEqual(protectionStatus(old(22), at(10, 12), balance), { protected: false, reason: null });
});
