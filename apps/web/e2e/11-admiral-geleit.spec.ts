// Neue Abläufe aus 0.17: Admiral führt eine Feldbesatzung und wird allein abgezogen; Handelsangebot mit Geleit des Anbieters.
import { expect, expectNoHorizontalOverflow, tapHex, test, until } from "./fixtures.ts";
import { fastForwardMission, reserveField, setBuildings, setResources, setUnits } from "./game.ts";

test.describe("Admiral bei Feldmission", () => {
  test.use({ spawnNear: "field" });

  test("Admiral führt Besetzung, bleibt bei der Besatzung und fährt allein heim", async ({ page, player, seed }) => {
    await setBuildings(seed.sql, player.baseId, { werft: 3, hafenkommandantur: 4, kommandozentrale: 4 });
    await setUnits(seed.sql, player.baseId, { korvette: 8, zerstoerer: 4 });
    await seed.sql`insert into admiral (player_id, base_id, name, xp, spec1) values (${player.id}, ${player.baseId}, 'Testmann', 0, 'angriff')`;
    // Feld für diesen Test atomar reservieren (TE-03: parallele Specs nehmen nie dasselbe Feld).
    const field = await reserveField(seed.sql, player);

    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
    await tapHex(page, player, field);
    await page.getByRole("button", { name: "Besetzen", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
    for (const name of ["Korvette", "Zerstörer"]) {
      await page.getByRole("listitem").filter({ hasText: new RegExp(`^${name}\\d`) }).getByRole("button", { name: "alle" }).click();
    }
    await page.getByRole("button", { name: /Testmann$/ }).click(); // Führung: Admiral wählen
    await expectNoHorizontalOverflow(page, "Besetzen mit Admiral");
    await page.getByRole("button", { name: "Auslaufen" }).click();
    await expect(page.getByRole("heading", { name: "Mission gestartet" })).toBeVisible();
    await page.getByRole("button", { name: "Fertig" }).click();

    const [m] = await seed.sql`select id from mission where player_id = ${player.id} order by id desc limit 1`;
    const [adm] = await seed.sql`select mission_id from admiral where player_id = ${player.id}`;
    expect(adm.mission_id).toBe(m.id);
    await fastForwardMission(seed.sql, m.id);
    await until(async () => (await seed.sql`select player_id from resource_field where id = ${field.id}`)[0].player_id === player.id, "Feld besetzt");

    // Admiralsansicht: Posten an der Besatzung, Abziehen ohne Rückruf.
    await page.reload();
    await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
    await page.getByRole("tab", { name: /^Einsatz/ }).click();
    await page.getByRole("button", { name: /^Admirale/ }).click();
    const recall = page.getByRole("button", { name: /^Admiral abziehen/ });
    await expect(recall).toBeVisible();
    await expectNoHorizontalOverflow(page, "Admiral bei der Besatzung");
    await recall.click();
    const home = await until(async () => (await seed.sql`select id, type, status from mission where player_id = ${player.id} and type = 'admiral_heimkehr'`)[0], "Heimfahrt angelegt");
    expect(home.status).toBe("returning");
    expect((await seed.sql`select player_id from resource_field where id = ${field.id}`)[0].player_id, "Besatzung hält das Feld").toBe(player.id);
  });
});

test("Handelsangebot mit Geleit des Anbieters", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, werft: 2 });
  await setUnits(seed.sql, player.baseId, { korvette: 3 });
  await setResources(seed.sql, player.baseId, { stahl: 5000, treibstoff: 5000, elektronik: 2000, proviant: 2000 });

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
  await page.getByRole("tab", { name: "Spieler" }).click();
  await page.getByRole("combobox", { name: "Gebe" }).selectOption("stahl");
  await page.getByRole("textbox", { name: "Menge geben" }).fill("1000");
  await page.getByRole("combobox", { name: "Will" }).selectOption("elektronik");
  await page.getByRole("textbox", { name: "Menge wollen" }).fill("300");
  const escort = page.getByRole("listitem").filter({ hasText: /^Korvette/ });
  await escort.getByRole("button", { name: "mehr" }).click();
  await escort.getByRole("button", { name: "mehr" }).click();
  await expectNoHorizontalOverflow(page, "Angebot mit Geleit");
  await page.getByRole("button", { name: "Angebot einstellen" }).click();
  await expect(page.getByText("Angebot eingestellt.")).toBeVisible();

  const [o] = await seed.sql`select escort from player_offer where seller_id = ${player.id} order by id desc limit 1`;
  expect(o.escort).toEqual({ korvette: 2 });
  await expect(page.getByText("Dein Geleit bei Annahme:")).toBeVisible();
});
