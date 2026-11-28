// Meldungen (alle Unterreiter, Nachricht an einen Mitspieler) und Handbuch (alle Kapitel, Neuigkeiten,
// Einstellungen, Verwaltung für Admins).
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

test("Meldungen: alle Unterreiter", async ({ page, player }) => {
  void player;
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ }).click();
  const tabs = page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab");
  // Vier kurze Reiter (UX 0.43, E-2/E-6): Berichte · Post · Allianz · Saison.
  await expect(tabs).toHaveCount(4);
  await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Berichte\s*\d*$/ })).toHaveAttribute("aria-selected", "true");
  for (const name of ["Berichte", "Post", "Allianz", "Saison"]) {
    await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: new RegExp(`^${name}\\s*\\d*$`) }).click();
    await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: new RegExp(`^${name}\\s*\\d*$`) })).toHaveAttribute("aria-selected", "true");
    await expectNoHorizontalOverflow(page, `Meldungen · ${name}`);
  }
  // Kein Scrollpfeil mehr: alle vier Reiter passen bei 390 px.
  for (const name of ["Berichte", "Saison"]) await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: new RegExp(`^${name}`) })).toBeInViewport();
  // Saison zeigt die Wertung mit dem eigenen Spieler; Bilanz, Erfolge und Welt sind Abschnitte der Saison.
  await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Saison/ }).click();
  await expect(page.getByRole("tabpanel").getByText(player.name).first()).toBeVisible();
  const inner = page.getByRole("tablist", { name: "Saison" });
  for (const name of ["Bilanz", "Erfolge", "Welt", "Wertung"]) {
    await inner.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
    await expect(inner.getByRole("tab", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-selected", "true");
    await expectNoHorizontalOverflow(page, `Meldungen · Saison · ${name}`);
  }
  // Pfeiltasten wechseln den Reiter (Tabs-Muster).
  await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Saison/ }).focus();
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
