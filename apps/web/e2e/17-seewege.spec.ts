// Seewege: Die Missionsplanung zeigt den Seeweg (Länge) und zeichnet die Route auf der Planungskarte; nach dem
// Auslaufen zeichnet die Karte die laufende Fahrt als Linienzug über die Wegpunkte (nicht als Gerade).
import { hexDistanceKm, seaRoute, terrainAt } from "@tidefront/world";
import { awayFromEdge, expect, expectNoHorizontalOverflow, tapHex, test } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

type Hex = { col: number; row: number };

test("Missionsplanung zeigt den Seeweg und zeichnet die Route; die Karte zeichnet die laufende Fahrt entlang der Route", async ({ page, player, seed }) => {
  test.slow(); // lange Abläufe; unter Parallel-Last sonst über 60 s
  await setBuildings(seed.sql, player.baseId, { werft: 3, kommandozentrale: 4, hafenkommandantur: 3, radarstation: 8, kraftwerk: 6 });
  await setUnits(seed.sql, player.baseId, { korvette: 4 });
  await setResources(seed.sql, player.baseId, { treibstoff: 20000 });
  const busy = new Set((await seed.sql`select col, row from nest union all select col, row from base union all select col, row from resource_field`).map((r) => `${r.col},${r.row}`));
  // Ziel in der Nähe, das nur mit Umweg über Wasser erreichbar ist (Kap, Halbinsel, Insel).
  let target: Hex | null = null;
  for (let dr = -7; dr <= 7 && !target; dr++) for (let dc = -7; dc <= 7 && !target; dc++) {
    const h = { col: player.col + dc, row: player.row + dr };
    const t = terrainAt(h.col, h.row);
    if (!awayFromEdge(h) || (t !== "sea" && t !== "coast") || busy.has(`${h.col},${h.row}`)) continue;
    const d = hexDistanceKm(player, h);
    if (d < 150 || d > 650) continue;
    const r = seaRoute(player, h);
    if (r.hexes.length >= 3 && r.km > 1.05 * d) target = h;
  }
  test.skip(!target, "kein Ziel mit Umweg neben diesem Hafen");
  const [n] = await seed.sql`insert into nest (col, row, level) values (${target!.col}, ${target!.row}, 1) returning id`;
  try {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
    await tapHex(page, player, target!);
    await expect(page.getByText(/Piratennest/).first()).toBeVisible();
    await page.getByRole("button", { name: "Mission planen" }).click();
    await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: /^Korvette\d/ }).getByRole("button", { name: "alle" }).click();
    // Weglänge der Route und gezeichnete Route auf der Planungskarte.
    await expect(page.getByText(/Seeweg [\d.]+ km/)).toBeVisible();
    await expect.poll(async () => Number(await page.locator("[data-planned-route]").first().getAttribute("data-planned-route"))).toBeGreaterThanOrEqual(3);
    await expectNoHorizontalOverflow(page, "Missionsplanung mit Seeweg");
    // Nur Korvetten, keine Landung: Probekampf unter 10 % → Rückfrage „aussichtslos“ (TST-05), hier bewusst bestätigen.
    page.once("dialog", (d) => { expect(d.message()).toContain("aussichtslos"); void d.accept(); });
    await page.getByRole("button", { name: "Auslaufen" }).click();
    await expect(page.getByRole("heading", { name: "Mission gestartet" })).toBeVisible();
    await page.getByRole("button", { name: "Fertig" }).click();
    // Laufende Fahrt auf der Karte: Linienzug mit mindestens drei Wegpunkten.
    await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
    await expect.poll(async () => Number(await page.locator("main [data-mission-route]").first().getAttribute("data-mission-route")), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  } finally {
    await seed.sql`delete from mission where player_id = ${player.id}`;
    await seed.sql`delete from nest where id = ${n.id}`;
  }
});
