// Ökostrom (v1.21): Elektrolyse ausbauen und in der Versorgung sehen; Seekabel zwischen zwei eigenen Häfen legen,
// Summen sehen und wieder trennen (Handy-Format, ohne waagrechtes Überlaufen).
import { expect, expectNoHorizontalOverflow, test, until } from "./fixtures.ts";
import { finishBuilds, foundingSpot, readState, setBuildings, setResources, updateState } from "./game.ts";

test("Elektrolyse ausbauen: Gebäudeblatt, Stufe 1, Versorgung mit Ökostrom-Anteil", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { kommandozentrale: 3, windpark: 3, stahlwerk: 1 });
  await setResources(seed.sql, player.baseId, { stahl: 9000, treibstoff: 4000, elektronik: 4000 });
  await page.goto("/?sub=hafen");
  await page.getByRole("button", { name: /^Elektrolyse 0/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/Strom-Stunden ergeben 1 Treibstoff/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Gebäudeblatt Elektrolyse");
  await sheet.getByRole("button", { name: "Ausbau auf 1" }).click();
  await expect(page.getByText("Elektrolyse · Ausbau auf Stufe 1")).toBeVisible();
  await finishBuilds(seed.sql, player.baseId);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Elektrolyse 1/ })).toBeVisible();
  expect((await readState(seed.sql, player.baseId)).buildings.elektrolyse).toBe(1);

  // Versorgung: Ökostrom-Anteil (sobald eine Stunde gezählt ist) und Hinweis auf das Seekabel.
  await updateState(seed.sql, player.baseId, (s) => {
    const h = Math.floor(Date.now() / 3600000);
    s.powerLog = { storedGreen: 0, hours: [[h - 1, 40, 50], [h, 10, 10]], greenUsed: 50, fuelMade: 0, sent: 0, drawn: 0, wasted: 0 };
  });
  await page.reload();
  await page.getByRole("button", { name: /^Versorgung \d/ }).click();
  await expect(page.getByTestId("oekostrom-anteil")).toContainText("Grüner Hafen");
  await expect(page.getByTestId("seekabel-hinweis")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Versorgung mit Elektrolyse");
});

test.describe("mit freiem Gründungsfeld", () => {
  test.use({ spawnNear: "founding" });

test("Seekabel zwischen eigenen Häfen legen, ansehen und trennen", async ({ page, player, seed }) => {
  // Zweiter eigener Hafen in Reichweite (Kopie des Heimathafens als Außenposten).
  // Innerhalb der Kabelreichweite (600 km); unter Parallel-Last sind die nächsten Felder oft schon belegt.
  const spot = await foundingSpot(seed.sql, player, 550, true);
  const home = await readState(seed.sql, player.baseId);
  const colonyState = { ...home, buildings: { ...home.buildings, seekabel: 1 }, site: undefined, colony: { foundedAtMs: Date.now() } };
  const [col] = await seed.sql`insert into base (player_id, name, col, row, state, is_home)
    values (${player.id}, ${"Kabelende"}, ${spot.col}, ${spot.row}, ${JSON.stringify(colonyState)}::jsonb, false) returning id`;
  await setBuildings(seed.sql, player.baseId, { seekabel: 1 });

  await page.goto("/?sub=hafen");
  await page.getByRole("button", { name: /^Versorgung \d/ }).click();
  const cable = page.getByTestId("seekabel");
  await expect(cable).toBeVisible();
  const row = cable.getByRole("listitem").filter({ hasText: "Kabelende" });
  await expect(row).toContainText("km");
  await expectNoHorizontalOverflow(page, "Seekabel: mögliche Partner");
  await row.getByRole("button", { name: "Kabel legen" }).click();
  await expect(cable.getByTestId("seekabel-kabel")).toContainText("Gibt Strom ab an Kabelende");
  const [c] = await until(async () => {
    const r = await seed.sql`select id, status from power_cable where from_base_id = ${player.baseId}`;
    return r.length > 0 ? r : null;
  }, "Kabel angelegt");
  expect(c.status).toBe("aktiv");
  expect((await readState(seed.sql, col.id as number)).cable?.role).toBe("in");
  await expectNoHorizontalOverflow(page, "Seekabel in Betrieb");

  page.once("dialog", (d) => void d.accept()); // Rückfrage bestätigen
  await cable.getByRole("button", { name: "Kabel trennen" }).click();
  await expect(cable.getByTestId("seekabel-kabel")).toHaveCount(0);
  await expect(cable.getByRole("button", { name: "Kabel legen" })).toBeVisible();
  expect((await seed.sql`select id from power_cable where id = ${c.id as number}`).length).toBe(0);
  expect((await readState(seed.sql, player.baseId)).cable ?? null).toBeNull();
});
});
