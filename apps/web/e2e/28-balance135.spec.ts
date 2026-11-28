// Balance v1.35 (Welle 3): Verwaltung mit „Vergeltung“ (KI-Spieler) und der Höchstgröße je Allianz; Missionsplanung
// gegen ein Nest zeigt, welcher Anteil der Beute in den Laderaum passt. Handy-Breite ohne waagrechten Überlauf.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

test.use({ spawnNear: "nest", viewport: { width: 390, height: 844 } });

test("Verwaltung: Vergeltung der KI schaltbar, Höchstgröße je Allianz", async ({ page, player, seed }) => {
  await seed.sql`update player set is_admin = true where id = ${player.id}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Verwaltung/ }).click();
  await page.getByRole("tab", { name: "Welt" }).click(); // KI-Spieler und Allianzgröße unter „Welt“ (UX-0.43 B3)
  const kiHead = page.getByRole("button", { name: /KI-Spieler/ });
  await kiHead.scrollIntoViewIfNeeded();
  await kiHead.click();
  const sw = page.getByRole("switch", { name: /Vergeltung/ });
  await expect(sw).toBeVisible({ timeout: 20000 });
  await expect(sw).toHaveAttribute("aria-checked", "true"); // Standard an
  const allyHead = page.getByRole("button", { name: /^Allianzen/ });
  await allyHead.scrollIntoViewIfNeeded();
  await allyHead.click();
  const size = page.getByLabel("Höchstgröße je Allianz");
  await expect(size).toBeVisible();
  expect(Number(await size.inputValue())).toBeGreaterThanOrEqual(3); // max(3, ⌈Menschen/2⌉)
  await expectNoHorizontalOverflow(page, "Verwaltung · Vergeltung und Allianzen");
});

test("Missionsplanung gegen ein Nest: Laderaum-Anteil der Beute", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 3, kaserne: 2, hafenkommandantur: 2, kommandozentrale: 5, radarstation: 8, kraftwerk: 6 });
  await setUnits(seed.sql, player.baseId, { korvette: 6, schuetzen: 60, landungsschiff: 1 });
  await setResources(seed.sql, player.baseId, { stahl: 50000, treibstoff: 20000, elektronik: 10000, proviant: 20000 });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: /^Einsatz/ }).click();
  const targets = page.locator("section").filter({ has: page.getByRole("heading", { name: "Nester in der Nähe" }) });
  const first = targets.locator("li[data-target]").first();
  await expect(first.getByText(/^\d+ %$/)).toBeVisible({ timeout: 20000 });
  page.once("dialog", (d) => void d.accept());
  await first.getByRole("button", { name: "Angreifen" }).click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
  await expect(page.getByTestId("laderaum-anteil")).toContainText(/Laderaum [\d.]+ für [\d.]+ Beute.*passt zu \d+ %/, { timeout: 15000 });
  await expectNoHorizontalOverflow(page, "Missionsplanung · Laderaum");
});
