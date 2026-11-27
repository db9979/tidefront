// Einstieg für neue Spieler: Auftrag „30 Schützen ausbilden“ führt per „Los“ zum Ausbilden, der nächste Auftrag
// rückt nach Ausbildungsende sofort weiter (Live-Meldung, nicht erst nach 60 s), Warnung bei vollem Lager,
// „Lohnende Ziele“ zeigt das Auftragsziel (Nest Stufe I) mit einem siegreichen Vorschlag.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { finishTraining, setBuildings, setResources, setUnits } from "./game.ts";

const DONE_1_TO_5 = { kraftwerk: 1, stahlwerk: 1, raffinerie: 1, versorgungshof: 1, kommandozentrale: 1, kaserne: 1 };

test("Auftragsbuch: Schützen-Auftrag führt zum Ausbilden, rückt live weiter, warnt vor vollem Lager", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, DONE_1_TO_5);
  await setResources(seed.sql, player.baseId, { stahl: 3000, treibstoff: 500, elektronik: 500, proviant: 3000 });
  await page.goto("/");

  const next = page.getByRole("region", { name: "Aufträge" });
  await expect(next.getByText("30 Schützen ausbilden")).toBeVisible();
  // Fünf erfüllte Aufträge: genau fünf abholbereit (Abschlussbelohnung nicht doppelt gezählt).
  await expect(next.getByRole("button", { name: /^Auftragsbuch: 5\/11, 5 abholbereit$/ })).toBeVisible();

  await next.getByRole("button", { name: "Los" }).click();
  await expect(page.getByRole("tab", { name: "Ausbilden" })).toHaveAttribute("aria-selected", "true");
  const sch = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Schützen: Info/ }) });
  await sch.getByLabel("Anzahl").fill("30");
  await sch.getByRole("button", { name: "Bauen" }).click();
  await expect(page.getByText(/30 × Schützen/)).toBeVisible();

  // Ausbildungsende: ohne Neuladen steht sofort der nächste Auftrag da.
  await page.getByRole("navigation").getByRole("button", { name: "Basis" }).click();
  await expect(next.getByText("30 Schützen ausbilden")).toBeVisible();
  await finishTraining(seed.sql, player.baseId);
  await expect(next.getByText("Werft bauen")).toBeVisible({ timeout: 10000 });

  // Lager fast voll: Warnung vor dem Abholen, Knopf zum Lagerkomplex.
  await setResources(seed.sql, player.baseId, { stahl: 4990 });
  await page.reload();
  await next.getByRole("button", { name: /^Auftragsbuch:/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/Lager zu voll: [\d.]+ verfielen/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "Auftragsbuch mit Lagerwarnung");
  await sheet.getByRole("button", { name: "Lagerkomplex ausbauen" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /Lagerkomplex/ })).toBeVisible();
});

test("Lohnende Ziele: Auftragsziel Nest Stufe I mit siegreichem Vorschlag", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { ...DONE_1_TO_5, werft: 1 });
  await setUnits(seed.sql, player.baseId, { korvette: 2, landungsschiff: 1, schuetzen: 30 });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: /^Einsatz/ }).click();
  const targets = page.locator("section").filter({ has: page.getByRole("heading", { name: "Nester in der Nähe" }) });
  const mission = targets.locator("li[data-target]").filter({ hasText: "Auftragsziel" });
  await expect(mission).toHaveCount(1);
  await expect(mission.getByText(/^Nest Stufe I$/)).toBeVisible();
  await expect(mission.getByText(/^(9\d|100) %$/)).toBeVisible({ timeout: 15000 });
  await expect(mission.getByLabel("Vorgeschlagener Verband")).toContainText("Schützen");
  await expectNoHorizontalOverflow(page, "Lohnende Ziele mit Auftragsziel");
});
