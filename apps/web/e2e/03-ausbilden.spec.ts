// Einheiten ausbilden: Werft und Kaserne per Seed, Korvetten und Schützen in Auftrag geben, vorspulen.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { finishTraining, finishTrainingUnits, readState, setBuildings, setResources } from "./game.ts";

test("Truppen: Korvetten und Schützen ausbilden", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 2, kaserne: 2, kraftwerk: 2, lagerkomplex: 3 });
  await setResources(seed.sql, player.baseId, { stahl: 5000, treibstoff: 3000, elektronik: 2000, proviant: 3000 });

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await expect(page.getByRole("heading", { name: "Truppen" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Truppen · Einsatz");
  await page.getByRole("tab", { name: "Ausbilden" }).click();
  await expectNoHorizontalOverflow(page, "Truppen · Ausbilden");
  // UI-01: Namensspalte mindestens 112 px (sonst brachen „Zerstörer“, „Landungsschiff“ mitten im Wort).
  const widths = await page.locator("li[data-train] span.font-serif").evaluateAll((els) => els.map((e) => [e.textContent, e.getBoundingClientRect().width] as const));
  expect(widths.length).toBeGreaterThan(3);
  for (const [name, w] of widths) expect(w, `Namensspalte ${name}`).toBeGreaterThanOrEqual(104);

  const row = (name: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${name}: Info`) }) });

  // Korvetten: 2 Stück
  const korv = row("Korvette");
  await korv.getByRole("button", { name: "mehr" }).click();
  await korv.getByRole("button", { name: "mehr" }).click();
  await expect(korv.getByLabel("Anzahl")).toHaveValue("2");
  await expectNoHorizontalOverflow(page, "Truppen mit Kosten");
  await korv.getByRole("button", { name: "Bauen" }).click();
  await expect(page.getByText(/2 × Korvette/)).toBeVisible();

  // Schützen: 10 Stück per Eingabe
  const sch = row("Schützen");
  await sch.getByLabel("Anzahl").fill("10");
  await sch.getByRole("button", { name: "Bauen" }).click();
  await expect(page.getByText(/10 × Schützen/)).toBeVisible();

  // Info-Blatt einer Einheit
  await row("Zerstörer").getByRole("button", { name: /^Zerstörer: Info/ }).click();
  await expect(page.getByRole("dialog").getByText("Kosten je Stück:")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Einheiten-Info");
  await page.keyboard.press("Escape");

  await finishTraining(seed.sql, player.baseId);
  const s = await readState(seed.sql, player.baseId);
  expect(s.units.korvette).toBe(2);
  expect(s.units.schuetzen).toBe(10);
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: "Ausbilden" }).click();
  await expect(page.getByRole("button", { name: "Korvette: Info, Bestand 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Schützen: Info, Bestand 10" })).toBeVisible();
});

test("Truppen: Teillieferung – fertige Korvetten stehen sofort im Bestand", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 2, kraftwerk: 2, lagerkomplex: 3 });
  await setResources(seed.sql, player.baseId, { stahl: 5000, treibstoff: 3000, elektronik: 2000, proviant: 3000 });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: "Ausbilden" }).click();
  const korv = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Korvette: Info/ }) });
  await korv.getByLabel("Anzahl").fill("3");
  await korv.getByRole("button", { name: "Bauen" }).click();
  const order = page.locator("[data-training-order=korvette]");
  await expect(order).toContainText("3 × Korvette");
  await expect(order).toContainText(/nächste in .* · alle in /);
  await expect(page.getByRole("button", { name: "Korvette: Info, Bestand 0" })).toBeVisible();

  // Erste Korvette fertig: der Worker liefert sie ohne Zutun des Spielers.
  await finishTrainingUnits(seed.sql, player.baseId, "werft", 1);
  const s = await readState(seed.sql, player.baseId);
  expect(s.units.korvette).toBe(1);
  expect(s.trainingQueue[0].done).toBe(1);
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: "Ausbilden" }).click();
  await expect(order).toContainText("3 × Korvette · 1 fertig");
  await expect(order).toContainText(/nächste in .* · alle in /);
  await expect(page.getByRole("button", { name: "Korvette: Info, Bestand 1" })).toBeVisible();

  await finishTraining(seed.sql, player.baseId);
  await expect(page.getByRole("button", { name: "Korvette: Info, Bestand 3" })).toBeVisible();
  await expect(order).toHaveCount(0);
});
