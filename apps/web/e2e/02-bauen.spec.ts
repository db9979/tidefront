// Gebäude ausbauen: Bauschlange füllen, wartenden Auftrag abbrechen, Bauzeit vorspulen, neue Stufe sehen.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { finishBuilds, readState } from "./game.ts";

test("Bauschlange: ausbauen, einreihen, abbrechen, fertigstellen", async ({ page, player, seed }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bauhof" })).toBeVisible();
  await expect(page.getByText("Der Bauhof ist frei.")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Basis");

  // Kraftwerk ausbauen
  await page.getByRole("button", { name: /^Kraftwerk 0/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Kosten")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Gebäudeblatt Kraftwerk");
  await sheet.getByRole("button", { name: "Ausbau auf 1" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText("Kraftwerk · Ausbau auf Stufe 1")).toBeVisible();
  await expect(page.getByText("Schlange 1/3")).toBeVisible();

  // Stahlwerk einreihen
  await page.getByRole("button", { name: /^Stahlwerk 0/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Einreihen: Stufe 1" }).click();
  await expect(page.getByText("Stahlwerk · Ausbau auf Stufe 1")).toBeVisible();
  await expect(page.getByText("Schlange 2/3")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Basis mit Bauschlange");

  // Wartenden Auftrag (Platz 2) abbrechen: Rückfrage bestätigen, Ressourcen voll zurück.
  const before = (await readState(seed.sql, player.baseId)).resources.stahl as number;
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("listitem").filter({ hasText: "Stahlwerk · Ausbau auf Stufe 1" }).getByRole("button", { name: "Abbruch" }).click();
  await expect(page.getByText("Stahlwerk · Ausbau auf Stufe 1")).toHaveCount(0);
  await expect(page.getByText("Schlange 1/3")).toBeVisible();
  expect((await readState(seed.sql, player.baseId)).resources.stahl).toBeGreaterThan(before);

  // Bauzeit vorspulen: der Worker schließt den Auftrag ab, die Oberfläche zeigt Stufe 1.
  await finishBuilds(seed.sql, player.baseId);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Kraftwerk 1/ })).toBeVisible();
  await expect(page.getByText("Der Bauhof ist frei.")).toBeVisible();
  expect((await readState(seed.sql, player.baseId)).buildings.kraftwerk).toBe(1);

  // Auftragsbuch rückt weiter (nächster Auftrag ist nicht mehr „Kraftwerk bauen“).
  await expect(page.getByRole("button", { name: "Nächster Auftrag Kraftwerk bauen" })).toHaveCount(0);
});
