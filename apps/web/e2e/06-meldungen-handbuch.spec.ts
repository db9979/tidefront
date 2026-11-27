// Meldungen (alle Unterreiter, Nachricht an einen Mitspieler) und Handbuch (alle Kapitel, Neuigkeiten,
// Einstellungen, Verwaltung für Admins).
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

test("Meldungen: alle Unterreiter", async ({ page, player }) => {
  void player;
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ }).click();
  const tabs = page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab");
  await expect(tabs).toHaveCount(6);
  for (const name of ["Berichte", "Bilanz", "Erfolge", "Nachrichten", "Rangliste", "Allianz"]) {
    await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: new RegExp(`^${name}`) }).click();
    await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-selected", "true");
    await expectNoHorizontalOverflow(page, `Meldungen · ${name}`);
  }
  // Rangliste zeigt den eigenen Spieler.
  await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Rangliste/ }).click();
  await expect(page.getByText(player.name).first()).toBeVisible();
});

test("Handbuch: Kapitel, Neuigkeiten, Einstellungen, Verwaltung", async ({ page, player, seed }) => {
  await seed.sql`update player set is_admin = true where id = ${player.id}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Handbuch und Einstellungen" }).click();
  await expect(page.getByRole("heading", { name: "Handbuch" })).toBeVisible();
  await expect(page.getByText(`Angemeldet als ${player.name}`)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Handbuch");

  // Jedes Kapitel aufklappen und prüfen.
  const sections = page.locator("main section");
  const n = await sections.count();
  expect(n).toBeGreaterThan(15);
  for (let i = 0; i < n; i++) {
    const head = sections.nth(i).getByRole("button").first();
    const title = (await head.textContent())?.replace(/[▾▴]/g, "").trim() ?? `Kapitel ${i + 1}`;
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expectNoHorizontalOverflow(page, `Handbuch · ${title}`);
  }

  // Sprungleiste öffnet ein Kapitel.
  await page.getByRole("navigation", { name: "Kapitel" }).getByRole("button", { name: "Börse" }).click();
  await expect(page.locator("#hb-boerse").getByRole("button").first()).toHaveAttribute("aria-expanded", "true");

  // Was ist neu?
  await page.getByRole("button", { name: /Was ist neu\?/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Was ist neu");
  await page.keyboard.press("Escape");

  // Einstellungen und Verwaltung
  await page.getByRole("button", { name: "Einstellungen" }).last().click();
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Einstellungen");
  await page.getByRole("button", { name: "Verwaltung öffnen" }).click();
  await expect(page.getByRole("heading", { name: "Verwaltung" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Einladungscodes" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Verwaltung");
});
