// Lieferverträge (v1.31): Reiter „Verträge“ der Börse – Angebot eines KI-Händlers annehmen, eigene Vertragsliste mit
// Status und Fälligkeit, Kündigung mit genauer Strafe; Vertrag einem Spieler anbieten und zurückziehen.
import { addBot, balance, removeBotStep } from "@tidefront/engine";
import { settle, storageCapacity, type BaseState } from "@tidefront/game-core";
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setBuildings, updateState } from "./game.ts";

test("Verträge: Angebot der Reederei annehmen, Liste mit Status, Kündigung", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 6 });
  await seed.sql`update player set trader = jsonb_set(trader, '{credits}', '20000'::jsonb) where id = ${player.id}`;
  // Ein Händler-KI mit vollem Stahllager; er zieht während des Tests nicht (nächster Zug in ferner Zukunft).
  const bot = await addBot(seed.engine, "haendler");
  expect(bot.ok, JSON.stringify(bot)).toBe(true);
  const { playerId: botId, name } = bot as { playerId: number; name: string };
  try {
    await seed.sql`update player set bot_state = jsonb_set(bot_state, '{nextActAt}', '99999999999999'::jsonb) where id = ${botId}`;
    const [kb] = await seed.sql`select id from base where player_id = ${botId}`;
    await updateState(seed.sql, kb.id as number, (s) => {
      s.buildings.lagerkomplex = 8;
      const cap = storageCapacity(settle(s as BaseState, Date.now(), balance), balance);
      s.resources = { ...s.resources, stahl: Math.floor(cap * 0.7), proviant: Math.floor(cap * 0.7) };
      s.resUpdatedAt = Date.now();
    });

    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
    await page.getByRole("tab", { name: "Verträge" }).click();
    await expect(page.getByText(/Heute den Preis festmachen/)).toBeVisible();
    const card = page.getByRole("region", { name });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Du kaufst Stahl" }).click();
    const form = page.getByRole("group", { name: `Vertrag ${name} Stahl` });
    await form.getByRole("textbox", { name: "Vertragsmenge" }).fill("1000");
    await form.getByRole("radio", { name: "2 Tage" }).click();
    const quote = form.getByTestId("contract-quote");
    await expect(quote).toContainText("an der Börse jetzt");
    await expect(quote).toContainText("Anzahlung jetzt");
    await expectNoHorizontalOverflow(page, "Börse · Verträge · Angebot");
    await form.getByRole("button", { name: "Vertrag abschließen" }).click();
    await expect(form.getByText(/Vertrag abgeschlossen/)).toBeVisible();

    const list = page.getByRole("list", { name: "Meine Verträge" });
    const row = list.getByTestId("contract-row").filter({ hasText: `Kauf 1.000 Stahl · von ${name}` });
    await expect(row).toBeVisible();
    await expect(row.getByText("offen", { exact: true })).toBeVisible();
    await expect(row).toContainText(/fällig .* Uhr \(in [12] T/);
    await expectNoHorizontalOverflow(page, "Börse · Verträge · Liste");

    // Kündigen nennt die genaue Strafe (25 % des Werts), danach steht der Vertrag als gekündigt in der Liste.
    await row.getByRole("button", { name: "Kündigen" }).click();
    const confirm = row.getByRole("group", { name: "Kündigung bestätigen" });
    await expect(confirm).toContainText(/Kündigen kostet dich \d[\d.]*,\d\d T/);
    await confirm.getByRole("button", { name: "Kündigung bestätigen" }).click();
    await expect(row.getByText("gekündigt", { exact: true })).toBeVisible();
  } finally {
    await seed.sql`delete from market_contract where buyer_id = ${botId} or seller_id = ${botId}`;
    await removeBotStep(seed.engine, botId);
  }
});

test("Verträge: einem Spieler einen Liefervertrag anbieten und zurückziehen", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 6 });
  await seed.sql`update player set trader = jsonb_set(trader, '{credits}', '20000'::jsonb) where id = ${player.id}`;
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
  await page.getByRole("tab", { name: "Verträge" }).click();
  await page.getByText("Selbst einen Vertrag anbieten").click();
  const form = page.getByRole("group", { name: "Vertrag anbieten" });
  await form.getByRole("radio", { name: "Ich kaufe" }).click();
  await form.getByRole("combobox", { name: "Vertragsressource" }).selectOption("proviant");
  await form.getByRole("textbox", { name: "Angebotsmenge" }).fill("800");
  await expect(form.getByText(/Erlaubt: .* bis .* je Einheit/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Börse · Verträge · Angebot an Spieler");
  await form.getByRole("button", { name: "Vertrag anbieten" }).click();
  await expect(form.getByText("Vertrag angeboten.")).toBeVisible();
  const row = page.getByRole("list", { name: "Meine Verträge" }).getByTestId("contract-row").filter({ hasText: "Kauf 800 Proviant · Angebot an alle" });
  await expect(row.getByText("angeboten", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Zurückziehen" }).click();
  await expect(row.getByText("zurückgezogen", { exact: true })).toBeVisible();
});
