// Oberfläche 0.23: Menü der Kopfleiste (statt „?“), Mini-Karte der Missionsplanung erst nach Antippen bedienbar,
// Neulinge sehen zuerst nur Überfall und Aufklärung, Einzahl „1 Einheit“, Besetzen ohne Landtruppen.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setBuildings, setUnits } from "./game.ts";

test.use({ viewport: { width: 390, height: 844 } });

test("Menü: Handbuch, Einstellungen, Verwaltung nur für Admins", async ({ page, player, seed }) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menü", exact: true });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await menu.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Menü" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Handbuch/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Einstellungen/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Abmelden/ })).toContainText(player.name);
  await expect(sheet.getByRole("button", { name: /^Verwaltung/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, "Menü");
  await sheet.getByRole("button", { name: /^Einstellungen/ }).click();
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();

  // Admin: Verwaltung direkt aus dem Menü.
  await seed.sql`update player set is_admin = true where id = ${player.id}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Verwaltung/ }).click();
  await expect(page.getByRole("heading", { name: "Verwaltung" })).toBeVisible();
  // Menü → Handbuch aus der Verwaltung heraus.
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Handbuch/ }).click();
  await expect(page.getByRole("heading", { name: "Handbuch" })).toBeVisible();
});

test("Missionsplanung: Mini-Karte gesperrt bis „Karte bedienen“, Neulingsarten, Einzahl", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 2, kaserne: 1, kommandozentrale: 2, kraftwerk: 3 });
  await setUnits(seed.sql, player.baseId, { korvette: 3, landungsschiff: 1, schuetzen: 10 });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: /^Einsatz/ }).click();
  await page.getByRole("button", { name: "Mission planen" }).first().click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();

  // Neuling (Kommandozentrale 2): nur Überfall und Aufklärung, Rest hinter „Weitere Missionsarten“.
  await expect(page.locator("main").getByRole("button", { name: /^Überfall/ })).toBeVisible();
  await expect(page.locator("main").getByRole("button", { name: /^Aufklärung/ })).toBeVisible();
  await expect(page.locator("main").getByRole("button", { name: /^Transport/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Weitere Missionsarten/ }).click();
  await expect(page.locator("main").getByRole("button", { name: /^Transport/ })).toBeVisible();
  await page.locator("main").getByRole("button", { name: /^Überfall/ }).click();

  // Mini-Karte: Deckfläche, Wischen über der Karte rollt die Seite.
  const map = page.getByTestId("plan-map");
  await expect(map.getByRole("button", { name: "Karte bedienen" })).toBeVisible();
  await expect(map).not.toHaveAttribute("data-active", "true");
  const box = (await map.boundingBox())!;
  const main = page.locator("main");
  const before = await main.evaluate((el) => el.scrollTop);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  await map.scrollIntoViewIfNeeded();
  await map.getByRole("button", { name: "Karte bedienen" }).click();
  await expect(map).toHaveAttribute("data-active", "true");
  await expect(map.getByRole("button", { name: "Fertig" })).toBeVisible();
  await map.getByRole("button", { name: "Fertig" }).click();
  await expect(map.getByRole("button", { name: "Karte bedienen" })).toBeVisible();

  // Einzahl in der Aktionsleiste.
  const row = page.getByRole("listitem").filter({ hasText: /^Korvette\d/ });
  await row.getByRole("button", { name: "mehr" }).click();
  await expect(page.getByText(/^1 Einheit( |$)/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Missionsplanung Neuling");

  // Rückweg „‹ Zurück“.
  await page.getByRole("button", { name: "Zurück" }).click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toHaveCount(0);
});
