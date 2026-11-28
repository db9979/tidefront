// Lagezentrum (Basis → Lage, Startseite der App seit dem Navigationsumbau): zeigt einen Börsenkonvoi (seit UX 0.43 nur
// unter Unterwegs mit Fortschritt, nicht doppelt unter „Als Nächstes“) und einen laufenden Ausbau; Antippen springt ins Gebäudeblatt (Basis → Hafen); die Zahl
// am Navigationszeichen „Basis“ steigt mit einer abholbaren Belohnung.
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
  // Startseite: Basis → Lage.
  await expect(page.getByRole("tablist", { name: "Basis" }).getByRole("tab", { name: /^Lage(\s*\d+)?$/ })).toHaveAttribute("aria-selected", "true");
  const soon = page.getByTestId("lage-soon");
  await expect(page.locator(`[data-lage-key="konvoi:${cv.id}"]`)).toHaveCount(0); // nur einmal: unter „Unterwegs“
  await expect(soon.locator(`[data-lage-key="bau:${player.baseId}:stahlwerk:3"]`)).toContainText("Stahlwerk Stufe 3 fertig");
  const way = page.getByTestId("lage-underway").locator(`[data-lage-key="konvoi-weg:${cv.id}"]`);
  await expect(way.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  await expect(way).toContainText(`von Handelshafen ${port.name}`);
  await expect(way).toContainText("Börsenlieferung: 100 Stahl");
  await expectNoHorizontalOverflow(page, "Basis · Lage");

  // Antippen: Bau → Basis → Hafen mit Gebäudeblatt.
  await soon.locator(`[data-lage-key="bau:${player.baseId}:stahlwerk:3"]`).getByRole("button").click();
  await expect(page.getByRole("dialog")).toContainText("Stahlwerk");
  await expect(page.getByRole("tablist", { name: "Basis" }).getByRole("tab", { name: /^Hafen/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");

  // Zahl am Navigationszeichen „Basis“ (auf dem Hafen, die Lage ist nicht offen): abholbare Erfolgsstufe kommt dazu.
  const loaded = page.waitForResponse((r) => r.url().includes("lage.badge"));
  await page.goto("/?sub=hafen");
  await loaded;
  await page.waitForLoadState("networkidle"); // Tagesbefehle/Auftragsbuch zählen mit
  const badge = page.getByTestId("nav-badge-basis");
  const before = (await badge.count()) > 0 ? Number(await badge.textContent()) : 0;
  await seed.sql`insert into achievement_tier (player_id, achievement_id, tier, reward) values (${player.id}, 'handel', 1, ${JSON.stringify({ stahl: 100 })}::jsonb)`;
  await page.reload();
  await expect(badge).toHaveText(String(before + 1));
  await expect(page.getByRole("navigation").getByRole("button", { name: /^Basis, \d+ (Eintrag wartet|Einträge warten) in der Lage/ })).toBeVisible(); // Textalternative (UI-18)
  await page.getByRole("tablist", { name: "Basis" }).getByRole("tab", { name: /^Lage/ }).click();
  await expect(page.getByTestId("lage-waiting").locator('[data-lage-key="belohnung:erfolge"]')).toContainText("abholbereit");
  // Neu seit dem letzten Öffnen markiert; nach dem Öffnen der Lage verschwindet die Zahl.
  await expect(page.getByTestId("lage-waiting").locator('[data-lage-key="belohnung:erfolge"]').getByLabel("neu")).toBeVisible();
  await expect(badge).toHaveCount(0);
  expect((await readState(seed.sql, player.baseId)).buildQueue).toHaveLength(1);
  await seed.sql`delete from convoy where id = ${cv.id}`;
});
