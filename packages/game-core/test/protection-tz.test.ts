// Nachtschild mit IANA-Zeitzone: Startstunde folgt der Sommerzeit; ältere Stände (nur Versatz) gelten weiter.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProtection, nightShieldWindow, scheduleNightShieldChange, settleNightShield, validTimeZone, zoneOffsetAt,
} from "../src/index.ts";
import { DAY, HOUR, loadBalance } from "./helpers.ts";

const balance = loadBalance();
const utc = (month: number, day: number, hour: number) => Date.UTC(2026, month - 1, day, hour);
const created = utc(1, 1, 0) - 100 * DAY;

test("Zeitzone: gültige Namen und Versatz mit Sommerzeit", () => {
  assert.equal(validTimeZone("Europe/Berlin"), true);
  assert.equal(validTimeZone("Mars/Olympus"), false);
  assert.equal(validTimeZone(""), false);
  assert.equal(zoneOffsetAt("Europe/Berlin", utc(1, 15, 12)), 60);
  assert.equal(zoneOffsetAt("Europe/Berlin", utc(7, 15, 12)), 120);
  assert.equal(zoneOffsetAt("America/New_York", utc(7, 15, 12)), -240);
});

test("Nachtschild 22 Uhr Berlin: im Winter 21:00 UTC, im Sommer 20:00 UTC", () => {
  const p = createProtection(created, 22, 60, "Europe/Berlin");
  assert.equal(p.timeZone, "Europe/Berlin");
  const winter = nightShieldWindow(p, utc(1, 15, 12), balance)!;
  assert.equal(winter.startMs, utc(1, 15, 21));
  const summer = nightShieldWindow(p, utc(7, 15, 12), balance)!;
  assert.equal(summer.startMs, utc(7, 15, 20));
  assert.equal(summer.endMs - summer.startMs, balance.protection.nightShieldHours * HOUR);
});

test("Umstellungstag: Fenster beginnt zur Ortszeit nach der Umstellung", () => {
  const p = createProtection(created, 22, 60, "Europe/Berlin");
  // 29.03.2026: Umstellung auf Sommerzeit um 2 Uhr; 22 Uhr Ortszeit = 20:00 UTC.
  const w = nightShieldWindow(p, utc(3, 29, 12), balance)!;
  assert.equal(w.startMs, utc(3, 29, 20));
});

test("Alter Stand ohne Zeitzone: fester Versatz wie bisher", () => {
  const p = createProtection(created, 22, 60);
  assert.equal(p.timeZone, undefined);
  assert.equal(nightShieldWindow(p, utc(7, 15, 12), balance)!.startMs, utc(7, 15, 21));
  // Ungültige Zone beim Anlegen: ignoriert.
  assert.equal(createProtection(created, 22, 60, "Kein/Ort").timeZone, undefined);
});

test("Änderung: Zone vormerken, übernehmen; gleiche Zone und Stunde ist unverändert", () => {
  const p = createProtection(created, 22, 60);
  const now = utc(7, 1, 12);
  const r = scheduleNightShieldChange(p, 22, 120, now, balance, "Europe/Berlin");
  assert.ok(r.ok);
  assert.equal(r.protection.nightShieldNext?.timeZone, "Europe/Berlin");
  const later = r.fromMs + 1;
  const s = settleNightShield(r.protection, later);
  assert.equal(s.timeZone, "Europe/Berlin");
  assert.equal(s.nightShieldNext, null);
  const again = scheduleNightShieldChange(s, 22, 60, later + 2 * balance.protection.nightShieldChangeHours * HOUR, balance, "Europe/Berlin");
  assert.deepEqual(again, { ok: false, code: "shield_unchanged" }, "Versatz egal, wenn die Zone gleich ist");
  assert.deepEqual(scheduleNightShieldChange(s, 23, 60, later + 2 * balance.protection.nightShieldChangeHours * HOUR, balance, "Nirgendwo/X"), { ok: false, code: "bad_tz" });
  // Wechsel zurück auf festen Versatz (alter Client): Zone entfällt beim Übernehmen.
  const back = scheduleNightShieldChange(s, 21, 60, later + 2 * balance.protection.nightShieldChangeHours * HOUR, balance);
  assert.ok(back.ok);
  assert.equal(settleNightShield(back.protection, back.fromMs).timeZone, undefined);
});
