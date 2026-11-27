// Rohstofffeld besetzen: Feld auf der Karte antippen, Besetzen planen, auslaufen, vorspulen, Feld gehört uns.
import { hexDistanceKm } from "@tidefront/world";
import { awayFromEdge, expect, expectNoHorizontalOverflow, tapHex, test, until } from "./fixtures.ts";
import { fastForwardMission, setBuildings, setUnits } from "./game.ts";

test.use({ spawnNear: "field" });

test("Rohstofffeld besetzen", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 3, hafenkommandantur: 4, kommandozentrale: 4 });
  await setUnits(seed.sql, player.baseId, { korvette: 8, zerstoerer: 4 });
  const fields = await seed.sql`select id, col, row, kind from resource_field where tier = 1 and player_id is null`;
  const field = fields
    .map((f) => ({ id: f.id as number, col: f.col as number, row: f.row as number, d: hexDistanceKm(player, { col: f.col as number, row: f.row as number }) }))
    .filter(awayFromEdge)
    .sort((a, b) => a.d - b.d)[0];

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await tapHex(page, player, field);
  await expect(page.getByText(/^Ertrag: .* je Stunde/)).toBeVisible();
  await expect(page.getByText("Besatzung unbekannt – erst aufklären.")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Karte mit Rohstofffeld");
  await page.getByRole("button", { name: "Besetzen", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
  for (const name of ["Korvette", "Zerstörer"]) {
    await page.getByRole("listitem").filter({ hasText: new RegExp(`^${name}\\d`) }).getByRole("button", { name: "alle" }).click();
  }
  await expect(page.getByText(/^Fahrt .* Treibstoff$/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Besetzen planen");
  await page.getByRole("button", { name: "Auslaufen" }).click();
  await expect(page.getByRole("heading", { name: "Mission gestartet" })).toBeVisible();
  await page.getByRole("button", { name: "Fertig" }).click();

  const [m] = await seed.sql`select id, type from mission where player_id = ${player.id} order by id desc limit 1`;
  expect(m.type).toBe("besetzen");
  await fastForwardMission(seed.sql, m.id);
  await until(async () => (await seed.sql`select player_id from resource_field where id = ${field.id}`)[0].player_id === player.id, "Feld besetzt");

  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: "Einsatz" }).click();
  await expect(page.getByRole("heading", { name: /^Meine Felder 1\// })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Truppen mit eigenem Feld");
});
