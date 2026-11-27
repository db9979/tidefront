// Lagerwarnung bei Tagesbefehlen (wie im Auftragsbuch): vor dem Abholen steht, wie viel verfiele, mit Bestand und
// Kapazität des Heimathafens, Knopf „Lagerkomplex ausbauen“ und „Trotzdem abholen“; danach nennt die Bestätigung
// den verfallenen Rest (Server liefert `lost`).
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setResources } from "./game.ts";

test("Tagesbefehl: Warnung bei fast vollem Lager, trotzdem abholen nennt den Verlust", async ({ page, player, seed }) => {
  await page.goto("/");
  const bar = page.getByRole("region", { name: "Aufträge" });
  await expect(bar.getByRole("button", { name: /^Tagesbefehle:/ })).toBeVisible(); // Befehle des Tages sind vergeben

  // Ersten Befehl erfüllen, Belohnung festlegen; Lager fast voll (Grundlager 5.000).
  const [row] = await seed.sql`
    update daily_challenge set progress = target, completed_at = now(), reward = ${JSON.stringify({ stahl: 500 })}::jsonb
    where id = (select id from daily_challenge where player_id = ${player.id} and claimed_at is null order by day desc, slot limit 1)
    returning id`;
  expect(row).toBeTruthy();
  await setResources(seed.sql, player.baseId, { stahl: 4990 });
  await page.reload();

  await bar.getByRole("button", { name: /^Tagesbefehle:.*abholbereit/ }).click();
  const sheet = page.getByRole("dialog");
  const warn = sheet.getByRole("note", { name: "Lagerwarnung" });
  await expect(warn).toBeVisible();
  await expect(warn.getByText(/^von 500 Stahl$/)).toBeVisible();
  await expect(warn.getByText(/^Lager 4\.99\d\/[\d.]+$/)).toBeVisible();
  await expect(warn.getByRole("button", { name: "Lagerkomplex ausbauen" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Tagesbefehle mit Lagerwarnung");

  await warn.getByRole("button", { name: "Trotzdem abholen" }).click();
  await expect(sheet.getByRole("status")).toContainText(/Lager voll: [\d.]+ Stahl verfallen\./);
  await expect(sheet.getByRole("note", { name: "Lagerwarnung" })).toHaveCount(0);
});
