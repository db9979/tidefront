// Mehrere Häfen: Kolonieschiff in der Werft bauen, Küstenfeld auf der Karte wählen, Außenposten gründen,
// per Hafenwahl wechseln, Hafen verwalten (umbenennen) – Heimathafen und Außenposten.
import { expect, expectNoHorizontalOverflow, openHafen, tapHex, test, until } from "./fixtures.ts";
import { fastForwardMission, finishTraining, foundingSpot, setBuildings, setResources } from "./game.ts";

test("Hafen verwalten: Heimathafen umbenennen", async ({ page, player, seed }) => {
  await page.goto("/?sub=hafen");
  await page.getByRole("button", { name: /^Hafen .* verwalten$/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Der Heimathafen lässt sich nicht aufgeben.")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Hafen verwalten (Heimathafen)");
  const input = sheet.getByLabel("Neuer Hafenname");
  // Ungültiger Name: Speichern bleibt gesperrt.
  await input.fill("x");
  await expect(sheet.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await input.fill("Neue Werft am Meer");
  await sheet.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Neue Werft am Meer" })).toBeVisible();
  const [b] = await seed.sql`select name from base where id = ${player.baseId}`;
  expect(b.name).toBe("Neue Werft am Meer");
});

test.describe("mit freiem Gründungsfeld", () => {
  test.use({ spawnNear: "founding" });

test("Kolonieschiff bauen, Außenposten gründen, Hafen wechseln und umbenennen", async ({ page, player, seed }) => {
  test.slow();
  await setBuildings(seed.sql, player.baseId, { kommandozentrale: 5, werft: 6, hafenkommandantur: 6, lagerkomplex: 6, kraftwerk: 5 });
  await setResources(seed.sql, player.baseId, { stahl: 9000, treibstoff: 5000, elektronik: 4000, proviant: 4000 });

  // Kolonieschiff in der Werft
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: "Ausbilden" }).click();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Kolonieschiff: Info/ }) });
  await row.getByRole("button", { name: "mehr" }).click();
  await row.getByRole("button", { name: "Bauen" }).click();
  await expect(page.getByText(/1 × Kolonieschiff/)).toBeVisible();
  await finishTraining(seed.sql, player.baseId);
  await page.reload();

  // Hafenwahl erscheint, sobald eine Gründung möglich ist.
  const switcher = page.getByRole("button", { name: /– Hafen wechseln$/ });
  await expect(switcher).toBeVisible();
  await switcher.click();
  await expect(page.getByRole("dialog").getByText("Weiteren Hafen gründen")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/1 Kolonieschiff daheim/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Deine Häfen (vor Gründung)");
  await page.getByRole("dialog").getByRole("button", { name: "Küstenfeld auf der Karte wählen" }).click();

  // Küstenfeld auf der Karte → Außenposten gründen
  const spot = await foundingSpot(seed.sql, player);
  await tapHex(page, player, spot);
  await expectNoHorizontalOverflow(page, "Karte mit freiem Küstenfeld");
  await page.getByRole("button", { name: "Außenposten gründen" }).click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
  const ship = page.getByRole("listitem").filter({ hasText: /^Kolonieschiff\d/ });
  await ship.getByRole("button", { name: "mehr" }).click();
  await expectNoHorizontalOverflow(page, "Gründung planen");
  const found = page.getByRole("button", { name: "Gründen", exact: true });
  await expect(found).toBeEnabled({ timeout: 30_000 }); // freigegeben erst mit der Vorschau des Servers – unter Last langsam
  await found.click();
  await expect(page.getByRole("heading", { name: "Mission gestartet" })).toBeVisible();
  await page.getByRole("button", { name: "Fertig" }).click();

  const [m] = await seed.sql`select id from mission where player_id = ${player.id} order by id desc limit 1`;
  await fastForwardMission(seed.sql, m.id);
  const colony = await until(async () => (await seed.sql`select id, name from base where player_id = ${player.id} and not is_home`)[0], "Außenposten gegründet");

  // Hafenwahl: zum Außenposten wechseln
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "Basis" }).click();
  await openHafen(page);
  await page.getByRole("button", { name: /– Hafen wechseln$/ }).click();
  const list = page.getByRole("dialog");
  await expect(list.getByRole("button", { name: "Hierhin wechseln" })).toHaveCount(1); // zwei Häfen, einer aktiv
  await expectNoHorizontalOverflow(page, "Deine Häfen (zwei Häfen)");
  await list.getByRole("listitem").filter({ hasText: colony.name as string }).getByRole("button", { name: "Hierhin wechseln" }).click();
  await expect(page.getByRole("heading", { level: 1, name: colony.name as string })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Hafen ${colony.name} – Hafen wechseln`) })).toContainText("Außenposten");
  await expectNoHorizontalOverflow(page, "Basis des Außenpostens");

  // Außenposten umbenennen; Aufgeben-Bereich ist sichtbar.
  await page.getByRole("button", { name: /^Hafen .* verwalten$/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Kolonie aufgeben", { exact: true })).toBeVisible();
  await sheet.getByLabel("Neuer Hafenname").fill("Vorposten Nord");
  await sheet.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Vorposten Nord" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Hafen verwalten (Außenposten)");
  await page.keyboard.press("Escape");

  // Zurück zum Heimathafen
  await page.getByRole("button", { name: /– Hafen wechseln$/ }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Heimathafen" }).getByRole("button", { name: "Hierhin wechseln" }).click();
  await expect(page.getByRole("button", { name: /– Hafen wechseln$/ })).toContainText("Heimathafen");
});
});
