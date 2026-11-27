// Admirale „Landungstrupp“ (docs/VORLAGE-ADMIRALE.md): Kachel zeigt fehlende Kosten statt „ernennen möglich“,
// Ernennen gesperrt mit „Was hilft?“; Umschulung eines alten Admirals einmal kostenlos mit Bestätigung; Wirkung in
// der Missionsplanung („Führung“) und im Probekampf.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

test.use({ spawnNear: "nest", viewport: { width: 430, height: 900 } });

test("Admiral: fehlende Kosten, Umschulung auf Landungstrupp, Wirkung im Probekampf", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 3, kaserne: 2, hafenkommandantur: 2, kommandozentrale: 3, radarstation: 8, kraftwerk: 6 });
  await setUnits(seed.sql, player.baseId, { korvette: 6, landungsschiff: 2, schuetzen: 30 });
  await setResources(seed.sql, player.baseId, { elektronik: 1000 });
  await seed.sql`update player set trader = jsonb_set(trader, '{credits}', '0'::jsonb) where id = ${player.id}`;

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: /^Einsatz/ }).click();
  const tile = page.getByRole("button", { name: /^Admirale 0\/1/ });
  await expect(tile).toContainText("Platz frei – fehlt: 2.000 Taler");
  await expect(tile.getByLabel("jetzt möglich")).toHaveCount(0);
  await tile.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "Ernennen" })).toBeDisabled();
  await expect(sheet.getByText("Fehlt: 2.000 Taler.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Landungstrupp" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Ernennen gesperrt");
  await page.keyboard.press("Escape");

  // Admiral von vor dem Update (Spalte retrain_free mit Vorgabe true): Umschulung mit Bestätigung.
  await seed.sql`insert into admiral (player_id, base_id, name, xp, spec1) values (${player.id}, ${player.baseId}, 'Testmann', 0, 'angriff')`;
  await page.reload();
  await page.getByRole("button", { name: /^Admirale 1\/1/ }).click();
  await sheet.getByRole("button", { name: "Umschulen …" }).click();
  await sheet.getByRole("button", { name: "Landungstrupp" }).click();
  await expect(sheet.getByText(/Angriff der Truppen \+10 %/)).toBeVisible();
  await sheet.getByRole("button", { name: "Umschulen auf Landungstrupp" }).click();
  await expect(sheet.getByText(/nur dieses eine Mal/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Umschulung bestätigen");
  await sheet.getByRole("button", { name: "Ja, endgültig umschulen" }).click();
  await expect(sheet.getByText(/Auf Mission: Angriff der Truppen \+5 % · LP Truppen \+4 % · Minenschaden −15 %/)).toBeVisible();
  await expect(sheet.getByText(/^Verteidigung: LP Truppen \+3 %$/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Umschulen …" })).toHaveCount(0);
  const [a] = await seed.sql`select spec1, retrain_free from admiral where player_id = ${player.id}`;
  expect(a.spec1).toBe("landung");
  expect(a.retrain_free).toBe(false);
  await page.keyboard.press("Escape");

  // Planung gegen ein Nest: Führung zeigt die Wirkung, der Probekampf rechnet sie ein.
  const targets = page.locator("section").filter({ has: page.getByRole("heading", { name: "Nester in der Nähe" }) });
  const first = targets.locator("li[data-target]").first();
  await expect(first.getByText(/^\d+ %$/)).toBeVisible({ timeout: 15000 });
  await first.getByRole("button", { name: "Angreifen" }).click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
  await page.getByRole("button", { name: /Testmann$/ }).click();
  await expect(page.getByText(/^Angriff der Truppen \+5 %/)).toBeVisible();
  await page.getByRole("button", { name: "Probekampf" }).click();
  await expect(page.getByTestId("probe-admiral")).toContainText("Mit Kapitän zur See Testmann: Angriff der Truppen +5 %");
  await expectNoHorizontalOverflow(page, "Probekampf mit Admiral");
});
