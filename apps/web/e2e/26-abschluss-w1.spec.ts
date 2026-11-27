// Abschlussprüfung 0.38, Welle 1: Schnellknöpfe der Order nie über „Max“ (TST-08); Vertragsangebot über der eigenen
// Vertragsgrenze ist in der Liste gekennzeichnet und „Annehmen“ gesperrt (TST-03).
import { addBot, contractBandView, proposePlayerContract, removeBotStep } from "@tidefront/engine";
import { expect, test } from "./fixtures.ts";
import { setBuildings, setResources, updateState } from "./game.ts";

const num = (s: string) => Number(s.replace(/\D/g, ""));

test("Order: Schnellknopf „10 %“ liegt nie über „Max“", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 14 });
  await setResources(seed.sql, player.baseId, { stahl: 120_000 });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
  await page.getByRole("tab", { name: "Handel" }).click();
  await expect(page.getByRole("heading", { name: "Order Stahl" })).toBeVisible();
  await page.getByRole("radio", { name: "Verkaufen", exact: true }).click();
  const tenth = page.getByRole("button", { name: /^10 % Bestand, / });
  const max = page.getByRole("button", { name: /^Maximum ohne Ablehnung, / });
  const t = num((await tenth.getAttribute("aria-label"))!.split(",")[1]);
  const m = num((await max.getAttribute("aria-label"))!.split(",")[1]);
  expect(m).toBeGreaterThan(0);
  expect(m, "Kurswirkung begrenzt unter 10 % des Bestands").toBeLessThan(12_000);
  expect(t).toBe(m);
  await tenth.click();
  await expect(page.locator("#tf-qty")).toHaveValue(String(m));
  await expect(page.getByText(/Kurswirkung zu groß/)).toHaveCount(0);
});

test("Verträge: Angebot über der Vertragsgrenze gekennzeichnet, Annehmen gesperrt", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 1 });
  await seed.sql`update player set trader = jsonb_set(trader, '{credits}', '20000'::jsonb) where id = ${player.id}`;
  const bot = await addBot(seed.engine, "haendler");
  expect(bot.ok, JSON.stringify(bot)).toBe(true);
  const botId = (bot as { playerId: number }).playerId;
  try {
    await seed.sql`update player set bot_state = jsonb_set(bot_state, '{nextActAt}', '99999999999999'::jsonb), trader = jsonb_set(trader, '{credits}', '50000'::jsonb) where id = ${botId}`;
    const [kb] = await seed.sql`select id from base where player_id = ${botId}`;
    await updateState(seed.sql, kb.id as number, (s) => {
      s.buildings.hafenkommandantur = 5; s.buildings.lagerkomplex = 10;
      s.resources = { ...s.resources, stahl: 50_000 };
      s.resUpdatedAt = Date.now();
    });
    const band = await contractBandView(seed.engine, "stahl", 2);
    const p = await proposePlayerContract(seed.engine, botId, `e2e-w1-${Date.now()}`, { side: "sell", resource: "stahl", qty: 9000, days: 2, price: band.course, target: player.name });
    expect(p.ok, JSON.stringify(p)).toBe(true);

    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
    await page.getByRole("tab", { name: "Verträge" }).click();
    const row = page.getByRole("list", { name: "Vertragsangebote von Spielern" }).getByRole("listitem").filter({ hasText: "9.000 Stahl" });
    await expect(row.locator("[data-contract-over-limit]")).toContainText(/Zu groß für dich: Vertragslieferungen höchstens [\d.]+ Stahl/);
    await expect(row.getByRole("button", { name: "Annehmen" })).toBeDisabled();
  } finally {
    await seed.sql`delete from market_contract where proposer_id = ${botId}`;
    await removeBotStep(seed.engine, botId);
  }
});
