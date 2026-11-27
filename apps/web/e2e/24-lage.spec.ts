// Lagezentrum (Meldungen → Lage, Startseite der Meldungen): zeigt einen Börsenkonvoi (Gleich/heute und Unterwegs mit
// Fortschritt) und einen laufenden Ausbau; Antippen springt ins Gebäudeblatt; die Zahl am Navigationszeichen
// „Meldungen“ steigt mit einer abholbaren Belohnung.
import { nearestTradePortBySea } from "@tidefront/world";
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { readState, setBuildings, updateState } from "./game.ts";

const HOUR = 3600_000;

test("Lage: Konvoi und Bau, Antippen springt, Zahl am Navigationszeichen bei abholbarer Belohnung", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { stahlwerk: 2 });
  const now = Date.now();
  await updateState(seed.sql, player.baseId, (s) => {
    s.buildQueue = [{ buildingId: "stahlwerk", targetLevel: 3, startedAt: now - 60_000, finishesAt: now + 2 * HOUR }];
  });
  const port = nearestTradePortBySea(player);
  const [cv] = await seed.sql`insert into convoy (kind, sender_id, recipient_id, recipient_base_id, from_col, from_row, to_col, to_row, cargo, depart_at, arrive_at)
    values ('boerse', null, ${player.id}, ${player.baseId}, ${port.col}, ${port.row}, ${player.col}, ${player.row}, ${JSON.stringify({ stahl: 100 })}::jsonb,
      ${new Date(now - HOUR).toISOString()}, ${new Date(now + 3 * HOUR).toISOString()}) returning id`;

  await page.goto("/");
  const nav = page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ });
  await nav.click();
  await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Lage(\s*\d+)?$/ })).toHaveAttribute("aria-selected", "true");
  const soon = page.getByTestId("lage-soon");
  await expect(soon.locator(`[data-lage-key="konvoi:${cv.id}"]`)).toContainText("Börsenlieferung trifft ein: 100 Stahl");
  await expect(soon.locator(`[data-lage-key="bau:${player.baseId}:stahlwerk:3"]`)).toContainText("Stahlwerk Stufe 3 fertig");
  const way = page.getByTestId("lage-underway").locator(`[data-lage-key="konvoi-weg:${cv.id}"]`);
  await expect(way.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  await expect(way).toContainText(`von Handelshafen ${port.name}`);
  await expectNoHorizontalOverflow(page, "Meldungen · Lage");

  // Antippen: Bau → Basis mit Gebäudeblatt.
  await soon.locator(`[data-lage-key="bau:${player.baseId}:stahlwerk:3"]`).getByRole("button").click();
  await expect(page.getByRole("dialog")).toContainText("Stahlwerk");
  await page.keyboard.press("Escape");

  // Zahl am Navigationszeichen: abholbare Erfolgsstufe kommt dazu.
  await page.goto("/");
  const badge = page.getByTestId("lage-badge");
  const before = (await badge.count()) > 0 ? Number(await badge.textContent()) : 0;
  await seed.sql`insert into achievement_tier (player_id, achievement_id, tier, reward) values (${player.id}, 'handel', 1, ${JSON.stringify({ stahl: 100 })}::jsonb)`;
  await page.reload();
  await expect(badge).toHaveText(String(before + 1));
  await nav.click();
  await expect(page.getByTestId("lage-waiting").locator('[data-lage-key="belohnung:erfolge"]')).toContainText("abholbereit");
  expect((await readState(seed.sql, player.baseId)).buildQueue).toHaveLength(1);
  await seed.sql`delete from convoy where id = ${cv.id}`;
});
