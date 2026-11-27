// Oberfläche: einheitliche Zeitformate (apps/web/src/lib/time.ts), Hochrechnung der Bestände mit Lagergrenze
// (live.res.ts) und die fälligen Zeitpunkte für das Nachladen (due-times.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtAgo, fmtAt, fmtDuration, fmtRange, fmtSeconds, fmtTime } from "../../../apps/web/src/lib/time.ts";
import { liveAmount, liveResources } from "../../../apps/web/src/lib/live.res.ts";
import { DUE_RETRIES_MS, dueTimes, nextRefresh } from "../../../apps/web/src/lib/due-times.ts";

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;

test("Restzeit: s unter 1 min, sonst min, h + min, T + h – nie „55:59 min“", () => {
  assert.equal(fmtDuration(45 * S), "45 s");
  assert.equal(fmtDuration(59 * S), "59 s");
  assert.equal(fmtDuration(60 * S), "1 min");
  assert.equal(fmtDuration(61 * S), "2 min"); // aufgerundet: höchstens 2 min
  assert.equal(fmtDuration(55 * MIN + 59 * S), "56 min");
  assert.equal(fmtDuration(H), "1 h");
  assert.equal(fmtDuration(H + 5 * MIN), "1 h 05 min");
  assert.equal(fmtDuration(H + 4 * MIN + 1 * S), "1 h 05 min");
  assert.equal(fmtDuration(59 * MIN + 30 * S), "1 h");
  assert.equal(fmtDuration(2 * 24 * H + 3 * H), "2 T 3 h");
  assert.equal(fmtDuration(24 * H), "1 T");
  assert.equal(fmtDuration(24 * H + 1 * S), "1 T 1 h");
  assert.equal(fmtDuration(0), "gleich");
  assert.equal(fmtDuration(-5 * S), "gleich");
  assert.equal(fmtDuration(Number.NaN), "gleich");
  assert.equal(fmtSeconds(90), "2 min");
  for (const ms of [1, 999, 61 * S, 3599 * S, 3601 * S, 86399 * S, 5 * 86400 * S + 7]) {
    assert.doesNotMatch(fmtDuration(ms), /\d:\d/, `kein Doppelpunkt-Format für ${ms}`);
  }
});

test("Alter: „gerade eben“, „vor 12 min“, „vor 2 h“, „vor 3 T“ (abgerundet)", () => {
  const now = 1_800_000_000_000;
  assert.equal(fmtAgo(now - 30 * S, now), "gerade eben");
  assert.equal(fmtAgo(now - 12 * MIN - 50 * S, now), "vor 12 min");
  assert.equal(fmtAgo(now - 2 * H - 59 * MIN, now), "vor 2 h");
  assert.equal(fmtAgo(now - 3 * 24 * H - H, now), "vor 3 T");
  assert.equal(fmtAgo(now + 5 * MIN, now), "gerade eben"); // Uhr leicht vor: nie negativ
});

test("Uhrzeit: heute ohne Datum, „morgen“, „gestern“, sonst Datum; fmtTime mit „Uhr“", () => {
  const base = new Date(2026, 10, 27, 12, 0).getTime(); // 27.11., 12:00 Ortszeit
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, 27 + d, h, m).getTime();
  assert.equal(fmtAt(at(0, 18), base), "18:00");
  assert.equal(fmtAt(at(1, 6), base), "morgen 06:00");
  assert.equal(fmtAt(at(-1, 21, 15), base), "gestern 21:15");
  assert.equal(fmtAt(at(3, 9, 30), base), "30.11. 09:30");
  assert.equal(fmtTime(at(0, 18), base), "18:00 Uhr");
  assert.equal(fmtTime(at(1, 6), base), "morgen 06:00 Uhr");
  assert.equal(fmtRange(at(0, 23), at(1, 6), base), "23:00–morgen 06:00 Uhr");
  assert.equal(fmtRange(at(1, 1), at(1, 6), base), "morgen 01:00–06:00 Uhr");
});

// Hafenansicht im Kleinen: nur die Felder, die die Hochrechnung liest.
const view = (resources: Record<string, number>, rates: Record<string, number>, capacity: number) =>
  ({ resources, rates, capacity }) as unknown as Parameters<typeof liveAmount>[0];

test("Hochrechnung: Förderung je Stunde bis zur Lagergrenze, Verbrauch nie unter 0", () => {
  const asOf = 1_800_000_000_000;
  const b = view({ stahl: 341, treibstoff: 4900, elektronik: 10, proviant: 50 }, { stahl: 208, treibstoff: 300, elektronik: 0, proviant: -100 }, 5000);
  // Stahl: 341 + 208/h · 0,5 h = 445
  assert.equal(liveAmount(b, asOf, asOf + 30 * MIN, "stahl"), 445);
  // Vor dem Stand (Uhr zurück): kein Rückwärtsrechnen
  assert.equal(liveAmount(b, asOf, asOf - 10 * MIN, "stahl"), 341);
  // Treibstoff stößt an die Lagergrenze
  assert.equal(liveAmount(b, asOf, asOf + H, "treibstoff"), 5000);
  // Ohne Förderung bleibt es
  assert.equal(liveAmount(b, asOf, asOf + 5 * H, "elektronik"), 10);
  // Proviant sinkt, aber nicht unter 0
  assert.equal(liveAmount(b, asOf, asOf + 15 * MIN, "proviant"), 25);
  assert.equal(liveAmount(b, asOf, asOf + 3 * H, "proviant"), 0);
  // Schon über der Grenze (z. B. Lager abgerissen): Bestand bleibt, wächst nicht weiter
  const over = view({ stahl: 6000 }, { stahl: 100 }, 5000);
  assert.equal(liveAmount(over, asOf, asOf + H, "stahl"), 6000);
  // Alle vier zusammen
  assert.deepEqual(liveResources(b, asOf, asOf + 30 * MIN), { stahl: 445, treibstoff: 5000, elektronik: 10, proviant: 0 });
});

test("Wartezeit sinkt mit dem hochgerechneten Bestand (Beispiel Stahlwerk: 194 Stahl fehlen)", () => {
  const asOf = 1_800_000_000_000;
  const b = view({ stahl: 341 }, { stahl: 208 }, 5000);
  const wait = (now: number) => ((535 - liveAmount(b, asOf, now, "stahl")) / 208) * H;
  assert.equal(fmtDuration(wait(asOf)), "56 min");
  assert.equal(fmtDuration(wait(asOf + 20 * MIN)), "36 min");
  assert.ok(wait(asOf + 56 * MIN) <= 0, "nach 56 min reicht der Stahl");
});

test("Fällige Zeitpunkte: Bau, Ausbildung, Forschung, Missionen, Angriffe, Lieferungen, Nachtschild; je zwei Nachholversuche", () => {
  const now = 1_800_000_000_000;
  const b = {
    buildQueue: [{ finishesAt: now + 10 * S }],
    trainingQueue: [{ finishesAt: now + 2 * MIN }],
    research: { order: { finishesAt: now + H } },
    missions: [{ status: "outbound", arriveAtMs: now + 5 * MIN, returnAtMs: now + 10 * MIN }, { status: "returning", arriveAtMs: now - H, returnAtMs: now + 20 * MIN }, { status: "holding", arriveAtMs: now - H, returnAtMs: now + 9 * H }],
    incoming: [{ arriveAtMs: now + 30 * MIN }],
    deliveries: [{ arriveAtMs: now + 40 * MIN }],
    protection: { nightWindow: { startMs: now + 6 * H, endMs: now + 14 * H } },
  } as unknown as Parameters<typeof dueTimes>[0];
  assert.deepEqual(dueTimes(b).sort((x, y) => x - y), [10 * S, 2 * MIN, 5 * MIN, 20 * MIN, 30 * MIN, 40 * MIN, H, 6 * H, 14 * H].map((d) => now + d));
  const times = dueTimes(b);
  assert.equal(nextRefresh(times, now), now + 10 * S + DUE_RETRIES_MS[0]);
  // Nach dem ersten Versuch kommt der zweite für denselben Zeitpunkt, danach nie wieder
  assert.equal(nextRefresh(times, now + 10 * S + DUE_RETRIES_MS[0]), now + 10 * S + DUE_RETRIES_MS[1]);
  assert.equal(nextRefresh([now - H], now), null);
});
