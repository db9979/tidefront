// Balance v1.38 (Welle 5): Gebäudeblatt der Elektrolyse rechnet nach der Stromvorhersage vor, ob die nächste Stufe sich
// lohnt (M-06). Der verdichtete Reiter „Verträge“ wird in 22-vertraege.spec.ts geprüft.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setBuildings } from "./game.ts";

test("Elektrolyse: Gebäudeblatt nennt Treibstoff je Tag der nächsten Stufe und rät ohne Überschuss ab", async ({ page, player, seed }) => {
  // Nur Kraftwerk, kein Wind und keine Sonne: es bleibt kein Ökostrom übrig.
  await setBuildings(seed.sql, player.baseId, { kraftwerk: 3, stahlwerk: 2, elektrolyse: 1, kommandozentrale: 3 });
  await page.goto("/?sub=hafen");
  await page.getByRole("button", { name: /^Elektrolyse 1/ }).click();
  const advice = page.getByRole("dialog").getByTestId("electrolysis-advice");
  await expect(advice).toContainText("brächte Stufe 2");
  await expect(advice).toContainText("Erst mehr Wind und Sonne bauen");
  await expectNoHorizontalOverflow(page, "Gebäudeblatt Elektrolyse");
});
