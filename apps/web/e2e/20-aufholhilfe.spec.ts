// Aufholhilfe: Baugutschrift unter der Ressourcenleiste und im Bauhof (Betrag, Herkunft, Erklärung), Kosten im
// Gebäudeblatt verrechnet; Ausbau mit leerem Lager allein aus der Gutschrift.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { readState, updateState } from "./game.ts";

test("Baugutschrift: sichtbar in Leiste und Bauhof, verrechnet in den Baukosten, bezahlt den Ausbau", async ({ page, player, seed }) => {
  await updateState(seed.sql, player.baseId, (s) => {
    s.resources = { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 };
    s.resUpdatedAt = Date.now();
    s.catchUp = { credit: 5000, bonus: 0.5, ratio: 0.2, active: true, lastAtMs: Date.now(), earned: 0, pack: 5000 };
  });
  await page.goto("/?sub=hafen"); // Bauhof unter Basis → Hafen

  // Ressourcenleiste: schmale Zeile mit Betrag und Herkunft.
  const strip = page.getByTestId("gutschrift-leiste");
  await expect(strip).toContainText("Baugutschrift 5.000");
  await expect(strip).toContainText("Aufholhilfe +50 %");
  await expectNoHorizontalOverflow(page, "Basis mit Baugutschrift");

  // Bauhof: Betrag, Herkunft, Erklärblatt.
  const line = page.getByTestId("gutschrift-bauhof");
  await expect(line).toContainText("Baugutschrift");
  await expect(line).toContainText("Herkunft: Aufholhilfe (mit Startpaket)");
  await line.click();
  const info = page.getByRole("dialog");
  await expect(info.getByTestId("gutschrift-erklaerung")).toContainText("nur Gebäude");
  await expect(info.getByTestId("gutschrift-erklaerung")).toContainText("20 %");
  await expectNoHorizontalOverflow(page, "Erklärblatt Aufholhilfe");
  await page.keyboard.press("Escape");
  await expect(info).toHaveCount(0);

  // Gebäudeblatt: Kosten aus der Gutschrift, nichts aus dem Lager; Ausbau trotz leerem Lager möglich.
  await page.getByRole("button", { name: /^Kraftwerk 0/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("kosten-gutschrift")).toContainText("Baugutschrift (Aufholhilfe):");
  await expect(sheet.getByTestId("kosten-gutschrift")).toContainText("aus dem Lager:");
  await expectNoHorizontalOverflow(page, "Gebäudeblatt mit Baugutschrift");
  await sheet.getByRole("button", { name: /^Bauen/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText("Kraftwerk · Ausbau auf Stufe 1")).toBeVisible();

  const s = await readState(seed.sql, player.baseId);
  expect(s.catchUp.credit).toBeLessThan(5000);
  expect(s.resources.stahl).toBeLessThan(5);
  await expect(page.getByTestId("gutschrift-leiste")).not.toContainText("Baugutschrift 5.000");
});
