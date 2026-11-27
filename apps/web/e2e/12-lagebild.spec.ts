// Lagebild: Ein fremdes Nest außerhalb jeder Sicht zeigt keine Stufe („Lage unbekannt“), eines in Radarreichweite
// schon (mit Quelle). Planung gegen das unbekannte Nest: „Lage unbekannt“, kein Probekampf.
import { COLS, hexDistanceKm } from "@tidefront/world";
import { awayFromEdge, expect, expectNoHorizontalOverflow, tapHex, test } from "./fixtures.ts";
import { setBuildings, setUnits } from "./game.ts";

test("Fremdes Nest: ohne Sicht keine Stufe, in Radarreichweite schon", async ({ page, player, seed }) => {
  test.slow(); // ~20 s allein, unter voller Parallel-Last sonst über 60 s
  // Radarstation 10 (550 km, bei dichtem Nebel mindestens 385 km) mit genug Strom.
  await setBuildings(seed.sql, player.baseId, { radarstation: 10, kraftwerk: 3, werft: 3, kommandozentrale: 4 });
  await setUnits(seed.sql, player.baseId, { korvette: 4 });
  const taken = new Set((await seed.sql`select col, row from nest union all select col, row from base`).map((r) => `${r.col},${r.row}`));
  /** Freies Feld in derselben Zeile, `minKm`–`maxKm` vom Hafen entfernt, abseits des Kartenrands. */
  const spot = (minKm: number, maxKm: number) => {
    for (let dc = 1; dc < COLS; dc++) for (const sign of [1, -1]) {
      const h = { col: player.col + sign * dc, row: player.row };
      const d = hexDistanceKm(player, h);
      if (d >= minKm && d <= maxKm && awayFromEdge(h) && !taken.has(`${h.col},${h.row}`)) return h;
    }
    return null;
  };
  const inRadar = spot(250, 360);
  const outside = spot(650, 1200);
  test.skip(!inRadar || !outside, "keine passenden Felder neben diesem Hafen");
  const ids: number[] = [];
  for (const [h, level] of [[inRadar!, 3], [outside!, 4]] as const) {
    const [n] = await seed.sql`insert into nest (col, row, level) values (${h.col}, ${h.row}, ${level}) returning id`;
    ids.push(n.id as number);
  }
  try {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();

    await tapHex(page, player, outside!);
    await expect(page.getByText("Piratennest – Lage unbekannt")).toBeVisible();
    await expect(page.getByTestId("lage-unbekannt")).toBeVisible();
    await expect(page.getByText(/Piratennest Stufe \d/)).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "Karte mit unbekanntem Nest");

    // Planung gegen das unbekannte Nest: keine Stufe, kein Probekampf.
    await page.getByRole("button", { name: "Mission planen" }).click();
    await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
    await expect(page.getByText(/Lage unbekannt/).first()).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: /^Korvette\d/ }).getByRole("button", { name: "alle" }).click();
    await expect(page.getByText(/^(Fahrt|Flug) .* Treibstoff$/)).toBeVisible(); // Flug bei reinem Luftverband
    await expect(page.getByRole("button", { name: "Probekampf" })).toHaveCount(0);

    await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
    await tapHex(page, player, inRadar!);
    await expect(page.getByText("Piratennest Stufe 3")).toBeVisible();
    await expect(page.getByText(/^Live: Radar /).first()).toBeVisible(); // Nest und ggf. Wrack auf demselben Feld
    await expectNoHorizontalOverflow(page, "Karte mit Nest im Radar");
  } finally {
    await seed.sql`delete from intel_sighting where kind = 'nest' and object_id in ${seed.sql(ids)}`;
    await seed.sql`delete from nest where id in ${seed.sql(ids)}`;
  }
});
