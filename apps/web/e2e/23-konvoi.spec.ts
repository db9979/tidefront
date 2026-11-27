// Konvois: Ein Börsenkauf fährt als Konvoi vom Handelshafen (Order zeigt Geleit und Risiko); auf der Karte fährt der
// Konvoi entlang der Route, Antippen öffnet das Konvoi-Blatt (Art, Absender → Empfänger, Ladung, Route).
import { hexAtXY, seaRoute } from "@tidefront/world";
import { convoyPosition } from "@tidefront/game-core";
import { expect, expectNoHorizontalOverflow, tapHex, test } from "./fixtures.ts";
import { setBuildings, setResources } from "./game.ts";

const DAY = 24 * 3600_000;

test("Börsenkauf als Konvoi: Risiko in der Order, Konvoi auf der Karte antippen öffnet das Blatt", async ({ page, player, seed }) => {
  test.slow();
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 3 });
  await setResources(seed.sql, player.baseId, { stahl: 4000 });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
  await page.getByRole("tab", { name: "Handel" }).click();
  await expect(page.getByRole("heading", { name: "Order Stahl" })).toBeVisible();

  // Erst Kredite: verkaufen.
  await page.getByRole("radio", { name: "Verkaufen", exact: true }).click();
  await page.locator("#tf-qty").fill("500");
  await page.getByRole("button", { name: /^Verkaufen · / }).click();
  await expect(page.getByRole("status").filter({ hasText: "Verkauft: 500 Stahl." })).toBeVisible();

  // Kaufen: Konvoi ab dem Handelshafen, Geleit wählbar, ohne Geleit ein Hinweis aufs Risiko.
  await page.getByRole("radio", { name: "Kaufen", exact: true }).click();
  await page.locator("#tf-qty").fill("100");
  await expect(page.getByText(/^Konvoi ab /)).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: /Kartell|Kriegsgegner/ })).toBeVisible();
  await page.getByRole("button", { name: "Geleit wählen" }).click();
  await expect(page.getByText(/Kein Geleitschutz möglich|Geleitschutz \(optional\)/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Börse · Order mit Geleit");
  await page.getByRole("button", { name: /^Kaufen · / }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gekauft: 100 Stahl" })).toBeVisible();

  const [cv] = await seed.sql`select id, from_col, from_row, to_col, to_row from convoy where recipient_id = ${player.id} and kind = 'boerse'`;
  expect(cv, "Börsenkauf reist als Konvoi").toBeTruthy();
  // Langsame Fahrt mitten auf der Route, damit die Position beim Antippen feststeht; kein Kartell.
  const now = Date.now();
  await seed.sql`update convoy set depart_at = ${new Date(now - 5 * DAY).toISOString()}, arrive_at = ${new Date(now + 5 * DAY).toISOString()}, cartel_at = null where id = ${cv.id}`;
  const from = { col: cv.from_col as number, row: cv.from_row as number };
  const to = { col: cv.to_col as number, row: cv.to_row as number };
  const p = convoyPosition({ route: seaRoute(from, to), from, to, departAtMs: now - 5 * DAY, arriveAtMs: now + 5 * DAY }, Date.now()).at;
  const hex = hexAtXY(p.x, p.y);

  await page.goto("/"); // frische Konvoidaten (Zeiten eben geändert)
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await tapHex(page, player, hex);
  const card = page.locator(`[data-convoy="${cv.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByText("Börsenkonvoi", { exact: true })).toBeVisible();
  await expect(card.getByText(/^Handelshafen .+ → du/)).toBeVisible();
  await expect(card.getByText(/Ladung: 100 Stahl/)).toBeVisible();
  await expect(card.getByText(/Route: Seeweg [\d.]+ km/)).toBeVisible();
  await expect(card.getByText(/Ankunft in/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Karte · Konvoi-Blatt");
  await seed.sql`delete from convoy where id = ${cv.id}`;
});
