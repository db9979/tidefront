import { test } from "node:test";
import assert from "node:assert/strict";
import { frontClouds, frontDistance, frontLines, weatherAt, weatherFrontsAt, weatherSystemsAt } from "../src/index.ts";
import { HOUR, loadBalance } from "./helpers.ts";

const wb = loadBalance().weather!;
const YEAR0 = Date.UTC(2026, 0, 1);
const R = 600;

test("Fronten: Warmfront nach Ost bis Südost, Kaltfront nach Süd bis Südwest (Zug nach Ost)", () => {
  const lines = frontLines(80, 0.2, R);
  const warm = lines.find((f) => f.kind === "warm")!;
  const cold = lines.find((f) => f.kind === "kalt")!;
  assert.equal(lines.some((f) => f.kind === "okklusion"), false, "junges Tief ohne Okklusion");
  const wEnd = warm.pts.at(-1)!;
  const cEnd = cold.pts.at(-1)!;
  assert.ok(wEnd.x > 0.9 * R && wEnd.y < 0, `Warmfront endet im Südosten: ${JSON.stringify(wEnd)}`);
  assert.ok(cEnd.y < -0.9 * R && cEnd.x < 0, `Kaltfront endet im Südwesten: ${JSON.stringify(cEnd)}`);
  // Beide beginnen am Kern.
  assert.deepEqual(warm.pts[0], { x: 0, y: 0 });
  assert.deepEqual(cold.pts[0], { x: 0, y: 0 });
});

test("Fronten: altes Tief hat eine Okklusion, Warm- und Kaltfront beginnen am Okklusionspunkt", () => {
  const lines = frontLines(80, 0.85, R);
  const occ = lines.find((f) => f.kind === "okklusion")!;
  assert.ok(occ, "Okklusion vorhanden");
  const tip = occ.pts.at(-1)!;
  assert.ok(Math.hypot(tip.x, tip.y) > 0.5 * R);
  for (const kind of ["warm", "kalt"] as const) assert.deepEqual(lines.find((f) => f.kind === kind)!.pts[0], tip);
});

test("Wolkenschirm: breit vor der Warmfront, im Warmsektor lichter, schmales Band an der Kaltfront", () => {
  const lines = frontLines(80, 0.2, R);
  const warm = lines.find((f) => f.kind === "warm")!;
  const mid = warm.pts[3];
  // Links der Warmfront (voraus, kalte Seite) und rechts (Warmsektor), je 0,35 Radien.
  const a = warm.pts[2], b = warm.pts[4];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const ahead = frontClouds(mid.x + nx * 0.35 * R, mid.y + ny * 0.35 * R, lines, R);
  const sector = frontClouds(mid.x - nx * 0.6 * R, mid.y - ny * 0.6 * R, lines, R);
  assert.ok(ahead > 0.6, `Schirm voraus ${ahead}`);
  assert.ok(sector < ahead / 2, `Warmsektor lichter ${sector}`);
  // Vorzeichen: voraus positiv.
  assert.ok(frontDistance(mid.x + nx * 0.35 * R, mid.y + ny * 0.35 * R, warm.pts).d > 0);
  // Kaltfront: auf der Linie dicht, 0,6 Radien seitlich fast klar.
  const cold = lines.find((f) => f.kind === "kalt")!;
  const c = cold.pts[3];
  assert.ok(frontClouds(c.x, c.y, lines, R) > 0.5);
  assert.ok(frontClouds(c.x - 0.6 * R, c.y, lines, R) < 0.1);
});

test("Wetterkarte: Fronten nur für kräftige Tiefs, deterministisch, Wolken an der Warmfront", () => {
  let checked = 0;
  for (let d = 0; d < 60 && checked < 5; d++) {
    const ms = YEAR0 + d * 24 * HOUR;
    const fronts = weatherFrontsAt(ms, wb);
    assert.deepEqual(fronts, weatherFrontsAt(ms, wb));
    const lows = weatherSystemsAt(ms, wb).filter((s) => s.sign > 0 && s.strength >= 0.35);
    assert.ok(fronts.filter((f) => f.kind === "warm").length === lows.length);
    for (const f of fronts.filter((x) => x.kind === "warm")) {
      // Etwas voraus der Mitte der Warmfront (Norden davon) ist es bewölkt.
      const p = f.points[2];
      const w = weatherAt({ lat: p.lat + 1.5, lon: p.lon + 0.5 }, ms, wb);
      assert.ok(w.clouds > 0.4, `Wolken vor der Warmfront ${w.clouds}`);
      checked++;
    }
  }
  assert.ok(checked > 0, "mindestens eine Front geprüft");
});
