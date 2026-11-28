// Meldungen (alle Unterreiter, Nachricht an einen Mitspieler) und Handbuch (alle Kapitel, Neuigkeiten,
// Einstellungen, Verwaltung für Admins).
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

test("Meldungen: alle Unterreiter", async ({ page, player }) => {
  void player;
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ }).click();
  const tabs = page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab");
  // Navigationsumbau: vier Reiter (Lage → Basis, Lagebild → Karte „Sichtungen“, Allianz aus Truppen).
  await expect(tabs).toHaveCount(4);
  await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Berichte\s*\d*$/ })).toHaveAttribute("aria-selected", "true");
  for (const name of ["Berichte", "Nachrichten", "Allianz", "Rangliste"]) {
    await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: new RegExp(`^${name}\\s*\\d*$`) }).click();
    await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: new RegExp(`^${name}\\s*\\d*$`) })).toHaveAttribute("aria-selected", "true");
    await expectNoHorizontalOverflow(page, `Meldungen · ${name}`);
  }
  // Kein Scrollpfeil mehr: alle vier Reiter passen bei 390 px.
  for (const name of ["Berichte", "Rangliste"]) await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: new RegExp(`^${name}`) })).toBeInViewport();
  // Rangliste zeigt den eigenen Spieler; Bilanz und Erfolge sind Abschnitte der Rangliste.
  await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Rangliste/ }).click();
  await expect(page.getByRole("tabpanel").getByText(player.name).first()).toBeVisible();
  const inner = page.getByRole("tablist", { name: "Rangliste" });
  for (const name of ["Bilanz", "Erfolge", "Wertung"]) {
    await inner.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
    await expect(inner.getByRole("tab", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-selected", "true");
    await expectNoHorizontalOverflow(page, `Meldungen · Rangliste · ${name}`);
  }
  // Pfeiltasten wechseln den Reiter (Tabs-Muster).
  await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Rangliste/ }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: /^Allianz/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /^Allianz/ })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText(/Allianz/);
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: /^Berichte\s*\d*$/ })).toHaveAttribute("aria-selected", "true"); // erster Reiter: Berichte
  // Truppen hat keine Allianz mehr.
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await expect(page.getByRole("tablist", { name: "Truppen" }).getByRole("tab")).toHaveCount(3);
  // Deep-Link der Server-Benachrichtigungen: ?tab=allianz öffnet Meldungen → Allianz.
  await page.goto("/?tab=allianz");
  await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Allianz/ })).toHaveAttribute("aria-selected", "true");
  await expectNoHorizontalOverflow(page, "Meldungen · Allianz");
});

test("Handbuch: Kapitel, Neuigkeiten, Einstellungen, Verwaltung", async ({ page, player, seed }) => {
  await seed.sql`update player set is_admin = true where id = ${player.id}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Handbuch/ }).click();
  await expect(page.getByRole("heading", { name: "Handbuch" })).toBeVisible();
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

  // Kapitelübersicht (Filterchips) öffnet ein Kapitel.
  await page.getByRole("navigation", { name: "Kapitel" }).getByRole("radio", { name: "Börse" }).click();
  await expect(page.locator("#hb-boerse").getByRole("button").first()).toHaveAttribute("aria-expanded", "true");

  // Was ist neu?
  await page.getByRole("button", { name: /Was ist neu\?/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Was ist neu");
  await page.keyboard.press("Escape");

  // Querverweis Einstellungen (Textlink): Zurück führt ins Handbuch zurück.
  await page.getByTestId("handbook-screen").getByRole("button", { name: "Einstellungen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expect(page.getByTestId("settings-screen").getByText(player.name, { exact: true })).toBeVisible(); // Konto: angemeldet als
  await expectNoHorizontalOverflow(page, "Einstellungen");
  await page.getByRole("button", { name: "Zurück" }).click();
  await expect(page.getByRole("heading", { name: "Handbuch" })).toBeVisible();

  // Verwaltung nur über das Menü (eigene Ansicht), Spieler-Reiter mit Einladungscodes.
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Verwaltung/ }).click();
  await expect(page.getByRole("heading", { name: "Verwaltung" })).toBeVisible();
  await page.getByRole("tab", { name: "Spieler" }).click();
  await expect(page.getByRole("heading", { name: "Einladungscodes" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Verwaltung");
});
