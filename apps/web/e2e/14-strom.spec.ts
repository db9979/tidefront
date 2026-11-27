// Stromfeld in der Kopfleiste (Bilanz, Speicher, Warnpunkt): Antippen öffnet die Versorgung in der Basis,
// auch von einem anderen Reiter aus. Dazu: bewegte Gebäudebilder laufen nur per CSS (Klassen „tf-mv“).
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setBuildings, setResources } from "./game.ts";

test("Stromfeld: Bilanz zeigen, Antippen öffnet die Versorgung", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { kraftwerk: 3, stahlwerk: 3, raffinerie: 2, chipfabrik: 2, speicherwerk: 2, windpark: 2, radarstation: 1 });
  await setResources(seed.sql, player.baseId, { treibstoff: 4000 });
  // Versorgung gemerkt zugeklappt: das Feld muss sie selbst aufklappen.
  await page.addInitScript(() => localStorage.setItem("tf-open:basis-versorgung", "0"));
  await page.goto("/?sub=hafen"); // Bauhof unter Basis → Hafen
  await expect(page.getByRole("heading", { name: "Bauhof" })).toBeVisible();

  const field = page.getByTestId("strom-feld");
  await expect(field).toBeVisible();
  await expect(field).toHaveAccessibleName(/^Strom: (Bilanz [+−±]\d|gedeckt)/);
  await expectNoHorizontalOverflow(page, "Kopfleiste mit Stromfeld");
  // UI-09: keine abgeschnittene Zeile im Stromfeld („KW 41…“).
  expect(await field.evaluate((el) => [...el.querySelectorAll("div")].every((d) => d.scrollWidth <= d.clientWidth + 1))).toBe(true);
  // Feld liegt vollständig in der Kopfleiste, der Menü-Knopf bleibt.
  const box = (await field.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(page.getByRole("button", { name: "Menü", exact: true })).toBeVisible();

  // Gebäudebilder: Stahlwerk produziert → bewegte Teile vorhanden (reine CSS-Animation).
  await expect(page.locator("main .tf-mv").first()).toBeAttached();

  // Von „Truppen“ aus antippen → Basis, Versorgung aufgeklappt und im Blick.
  await page.getByRole("button", { name: /^Truppen/ }).first().click();
  await field.click();
  const card = page.locator("#versorgung");
  await expect(card.getByRole("button", { name: /Versorgung/ })).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByText("Strom jetzt")).toBeInViewport();

  // Erneut: zuklappen, nach oben rollen, wieder antippen (Karte steht schon) → wieder auf.
  await card.getByRole("button", { name: /Versorgung/ }).click();
  await expect(card.getByText("Strom jetzt")).toHaveCount(0);
  await page.locator("main").evaluate((m) => { m.scrollTop = 0; });
  await field.click();
  await expect(card.getByText("Strom jetzt")).toBeInViewport();
});
