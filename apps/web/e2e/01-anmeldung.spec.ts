// Registrieren mit Einladungscode, Hafenwahl (Schnellwahl), Begrüßung, Abmelden und erneut Anmelden.
import { E2E } from "./env.ts";
import { expect, expectNoHorizontalOverflow, openHafen, resetRateLimits, test, uniqueName } from "./fixtures.ts";

test("Registrieren, Heimathafen wählen, abmelden, anmelden", async ({ page, seed }, testInfo) => {
  await resetRateLimits();
  const name = uniqueName("Neu");
  const password = "e2e-geheim-123";

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "TIDEFRONT" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Anmeldung");

  // Falscher Code wird abgewiesen.
  await page.getByRole("button", { name: "Registrieren" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel(/^Passwort/).fill(password);
  await page.getByLabel("Einladungscode").fill("FALSCH-CODE");
  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await expect(page.getByText(/Einladungscode/i).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Konto anlegen" })).toBeVisible();

  // Richtiger Code (Groß-/Kleinschreibung egal).
  await page.getByLabel("Einladungscode").fill(E2E.invite.toLowerCase());
  await page.getByRole("button", { name: "Konto anlegen" }).click();

  // Hafenwahl
  await expect(page.getByRole("heading", { name: "Standort für deinen Heimathafen" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Hafenwahl");
  await page.getByRole("button", { name: "Verstanden" }).click();
  const picks = page.getByRole("list", { name: "Schnellwahl" }).getByRole("listitem");
  await expect(picks).toHaveCount(8);
  // Wiederholte Läufe (--repeat-each) nehmen verschiedene Vorschläge, damit parallele Läufe nicht um dasselbe Feld ringen.
  await picks.nth(testInfo.repeatEachIndex % 7).click();
  await expect(page.getByText("Handelshafen")).toBeVisible();
  // UX 0.43 (O-1): Name mit dem Ortsnamen vorbelegt – „Heimathafen gründen“ ist sofort aktiv.
  await expect(page.getByLabel("Name des Hafens")).not.toHaveValue("");
  await expect(page.getByRole("button", { name: "Heimathafen gründen" })).toBeEnabled();
  const harbor = `Heimat ${name.slice(-4)}`;
  await page.getByLabel("Name des Hafens").fill(harbor);
  await expectNoHorizontalOverflow(page, "Hafenwahl mit Auswahl");
  await page.getByRole("button", { name: "Heimathafen gründen" }).click();

  // Begrüßung (UX 0.43: zwei Seiten); die letzte endet mit „Kraftwerk bauen“ und öffnet dessen Blatt.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Dein Heimathafen steht" })).toBeVisible();
  await expect(dialog).toContainText("Menü → Einstellungen"); // Nachtschild: schon gewählt, änderbar
  await expectNoHorizontalOverflow(page, "Begrüßung");
  await dialog.getByRole("button", { name: "Weiter" }).click();
  await dialog.getByRole("button", { name: "Kraftwerk bauen" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: /^Bauen · / })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tablist", { name: "Basis" }).getByRole("tab", { name: /^Lage/ }).click();

  // Startseite Basis → Lage; Hafen-Kopf und Bauhof unter Basis → Hafen.
  await expect(page.getByTestId("lage-tab")).toBeVisible();
  await openHafen(page);
  await expect(page.getByRole("heading", { level: 1, name: harbor })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bauhof" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Basis");
  const [row] = await seed.sql`select b.name from base b join player p on p.id = b.player_id where p.name = ${name} and b.is_home`;
  expect(row.name).toBe(harbor);

  // Abmelden über Menü → Abmelden, dann wieder anmelden.
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Abmelden/ }).click();
  await expect(page.getByRole("button", { name: "Anmelden" }).first()).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel(/^Passwort/).fill("falsches-passwort");
  await page.getByRole("button", { name: "Anmelden" }).last().click();
  await expect(page.getByText(/falsch|unbekannt/i)).toBeVisible();
  await page.getByLabel(/^Passwort/).fill(password);
  await page.getByRole("button", { name: "Anmelden" }).last().click();
  // Begrüßung erscheint nicht erneut (je Spieler und Gerät gemerkt).
  await expect(page.getByTestId("lage-tab")).toBeVisible();
  await openHafen(page);
  await expect(page.getByRole("heading", { level: 1, name: harbor })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
