// TE-07: eine Spielzeitzone für alle (gameTimeZone), robust gegen TZ-Werte, die Intl nicht kennt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GAME_TIME_ZONE, gameTimeZone, market } from "../src/index.ts";

function withTz<T>(tz: string | undefined, fn: () => T): T {
  const prev = process.env.TZ;
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

test("gameTimeZone: gültige TZ wird übernommen, sonst Europe/Berlin", () => {
  assert.equal(withTz("UTC", gameTimeZone), "UTC");
  assert.equal(withTz("America/New_York", gameTimeZone), "America/New_York");
  assert.equal(withTz(undefined, gameTimeZone), DEFAULT_GAME_TIME_ZONE);
  assert.equal(withTz("", gameTimeZone), DEFAULT_GAME_TIME_ZONE);
  assert.equal(withTz(":/etc/localtime", gameTimeZone), DEFAULT_GAME_TIME_ZONE);
  assert.equal(withTz("Mars/Olympus", gameTimeZone), DEFAULT_GAME_TIME_ZONE);
});

test("gameTimeZone: mit TZ=':/etc/localtime' wirft toLocaleString nicht (vorher RangeError)", () => {
  withTz(":/etc/localtime", () => {
    const s = new Date(Date.UTC(2026, 0, 15, 12, 0)).toLocaleString("de-DE", { timeZone: gameTimeZone(), hour: "2-digit", minute: "2-digit" });
    assert.equal(s, "13:00");
  });
});

test("Spieltag der Börse nutzt dieselbe Zeitzone", () => {
  const ms = Date.UTC(2026, 0, 15, 23, 30); // Berlin: 16.01. 00:30, UTC: 15.01.
  const berlin = withTz(":/etc/localtime", () => market.gameDayIndex(ms));
  const utc = withTz("UTC", () => market.gameDayIndex(ms));
  assert.equal(berlin, utc + 1);
  assert.equal(withTz("UTC", () => market.defaultTimeZone()), "UTC");
});
