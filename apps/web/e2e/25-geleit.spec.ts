// Empfohlenes Geleit je Frachtwert: Die Börsen-Order zeigt den Kasten „Geleitschutz“ (erwartete Kartellgruppe,
// Empfehlung mit Siegchance, Abwägung); „Empfehlung übernehmen“ setzt die Mengen im Geleit-Wähler, der Kauf fährt mit
// diesem Geleit. Im Konvoi-Blatt rechnet „Probekampf gegen das Kartell“ das Geleit gegen die erwartete Gruppe.
import { hexAtXY, hexDistanceKm, seaRoute, terrainAt } from "@tidefront/world";
import { convoyPosition } from "@tidefront/game-core";
import { expect, expectNoHorizontalOverflow, tapHex, test } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

const DAY = 24 * 3600_000;

test("Börsen-Order: Empfehlung übernehmen setzt das Geleit; Konvoi-Blatt: Probekampf gegen das Kartell", async ({ page, player, seed }) => {
  test.slow();
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 3, werft: 3 });
  await setResources(seed.sql, player.baseId, { stahl: 4000, treibstoff: 4000 });
  await setUnits(seed.sql, player.baseId, { korvette: 6 });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
  await page.getByRole("tab", { name: "Handel" }).click();
  await expect(page.getByRole("heading", { name: "Order Stahl" })).toBeVisible();

  // Erst Taler: verkaufen.
  await page.getByRole("radio", { name: "Verkaufen", exact: true }).click();
  await page.locator("#tf-qty").fill("1000");
  await page.getByRole("button", { name: /^Verkaufen · / }).click();
  await expect(page.getByRole("status").filter({ hasText: "Verkauft: 1.000 Stahl." })).toBeVisible();

  // Kaufen: Kasten „Geleitschutz“ mit Empfehlung, Siegchance und Abwägung.
  await page.getByRole("radio", { name: "Kaufen", exact: true }).click();
  await page.locator("#tf-qty").fill("600");
  const box = page.getByRole("group", { name: "Geleitschutz" });
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("data-escort-advice", "ok");
  await expect(box.getByText(/Erwartete Kartellgruppe: \d+ Schnellboote?/)).toBeVisible();
  await expect(box.getByText(/Empfehlung: .*Korvette/)).toBeVisible();
  await expect(box.getByText(/hält im Probekampf in [\d,]+ %/)).toBeVisible();
  await expect(box.getByText(/Ohne Geleit erwarteter Verlust ~/)).toBeVisible();
  await expect(box.getByText(/^Lohnt sich/)).toBeVisible();
  await box.getByRole("button", { name: "Empfehlung übernehmen" }).click();
  await expect(box.getByRole("button", { name: "Empfehlung übernommen" })).toBeDisabled();
  // Der Geleit-Wähler ist offen und zeigt die übernommene Zahl.
  await expect(page.getByText("Geleitschutz (optional)")).toBeVisible();
  const n = Number(await page.locator("[data-order-escort]").getByLabel("Anzahl").first().inputValue());
  expect(n).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page, "Börse · Order mit Geleitempfehlung");
  await page.getByRole("button", { name: /^Kaufen · / }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gekauft: 600 Stahl" })).toBeVisible();

  const [cv] = await seed.sql`select id, escort, from_col, from_row, to_col, to_row from convoy where recipient_id = ${player.id} and kind = 'boerse'`;
  expect(cv, "Börsenkauf reist als Konvoi").toBeTruthy();
  expect(cv.escort).toEqual({ korvette: n });

  // Konvoi-Blatt: langsame Fahrt mitten auf der Route, kein Kartell; Probekampf gegen die erwartete Gruppe. Start auf
  // offener See weiter weg, damit die Konvoimitte nicht unter dem Geleitverband (auf dem Weg zum Handelshafen) liegt.
  const to = { col: cv.to_col as number, row: cv.to_row as number };
  let from = { col: cv.from_col as number, row: cv.from_row as number };
  search: for (let r = to.row - 10; r <= to.row + 10; r++) for (let c = to.col - 10; c <= to.col + 10; c++) {
    const d = hexDistanceKm(to, { col: c, row: r });
    if (terrainAt(c, r) === "sea" && d >= 250 && d <= 450 && hexDistanceKm(from, { col: c, row: r }) >= 200 && seaRoute({ col: c, row: r }, to).hexes.length >= 4) { from = { col: c, row: r }; break search; }
  }
  const now = Date.now();
  await seed.sql`update convoy set from_col = ${from.col}, from_row = ${from.row}, depart_at = ${new Date(now - 5 * DAY).toISOString()}, arrive_at = ${new Date(now + 5 * DAY).toISOString()}, cartel_at = null where id = ${cv.id}`;
  const p = convoyPosition({ route: seaRoute(from, to), from, to, departAtMs: now - 5 * DAY, arriveAtMs: now + 5 * DAY }, Date.now()).at;
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await tapHex(page, player, hexAtXY(p.x, p.y));
  const card = page.locator(`[data-convoy="${cv.id}"]`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Probekampf gegen das Kartell" }).click();
  const res = card.locator("[data-convoy-probe-result]");
  await expect(res.getByText(/Kartellgruppe für diese Ladung: \d+ Schnellboote?/)).toBeVisible();
  await expect(res.getByText(/hält in [\d,]+ % der Probekämpfe/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Karte · Konvoi-Blatt mit Probekampf");
  await seed.sql`delete from convoy where id = ${cv.id}`;
});
