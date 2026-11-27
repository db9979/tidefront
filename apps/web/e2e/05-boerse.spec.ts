// Börse: Stahl verkaufen (sofort Kredite), Stahl kaufen (Konvoi), Lieferung vorspulen, Unterreiter ansehen.
import { expect, expectNoHorizontalOverflow, test, until } from "./fixtures.ts";
import { readState, setBuildings, setResources } from "./game.ts";

test("Börse: verkaufen und kaufen", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 3 });
  await setResources(seed.sql, player.baseId, { stahl: 4000 });

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
  await page.getByRole("tab", { name: "Handel" }).click();
  await expect(page.getByRole("heading", { name: "Order Stahl" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Börse · Handel");

  // Verkaufen
  await page.getByRole("radio", { name: "Verkaufen", exact: true }).click();
  await page.locator("#tf-qty").fill("500");
  const sell = page.getByRole("button", { name: /^Verkaufen · / });
  await expect(sell).toBeEnabled();
  await expectNoHorizontalOverflow(page, "Börse · Verkaufsorder");
  await sell.click();
  await expect(page.getByRole("status").filter({ hasText: "Verkauft: 500 Stahl." })).toBeVisible();
  const afterSell = (await readState(seed.sql, player.baseId)).resources.stahl as number;
  expect(afterSell).toBeLessThan(3600);
  const [p1] = await seed.sql`select trader from player where id = ${player.id}`;
  expect(Number((p1.trader as { credits: number }).credits)).toBeGreaterThan(0);

  // Kaufen: Lieferung per Konvoi
  await page.getByRole("radio", { name: "Kaufen", exact: true }).click();
  await page.locator("#tf-qty").fill("100");
  const buy = page.getByRole("button", { name: /^Kaufen · / });
  await expect(buy).toBeEnabled();
  await buy.click();
  await expect(page.getByRole("status").filter({ hasText: "Gekauft: 100 Stahl" })).toBeVisible();
  const [d] = await seed.sql`select id, status, arrive_at, depart_at from delivery where player_id = ${player.id}`;
  expect(d, JSON.stringify(await seed.sql`select * from delivery where player_id = ${player.id}`)).toBeTruthy();
  expect(d.status).toBe("underway");
  await expectNoHorizontalOverflow(page, "Börse nach Kauf");

  // Konvoi vorspulen
  const before = (await readState(seed.sql, player.baseId)).resources.stahl as number;
  await seed.sql`update delivery set arrive_at = now() where id = ${d.id}`;
  await seed.sql`update game_event set due_at = now() where type = 'delivery_arrive' and status = 'pending' and payload->>'deliveryId' = ${d.id}`;
  await until(async () => (await seed.sql`select status from delivery where id = ${d.id}`)[0].status === "delivered", "Lieferung angekommen");
  expect((await readState(seed.sql, player.baseId)).resources.stahl).toBeGreaterThanOrEqual(before + 99);

  // Weitere Unterreiter
  await page.getByRole("tab", { name: "Spieler" }).click();
  await expectNoHorizontalOverflow(page, "Börse · Spieler");
  await page.getByRole("tab", { name: "Nachrichten" }).click();
  await expect(page.getByRole("heading", { name: "Marktnachrichten" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Börse · Nachrichten");
});
