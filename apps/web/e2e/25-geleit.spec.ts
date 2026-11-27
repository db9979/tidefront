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
  // Die Konvoimitte muss weit weg vom eigenen Hafen (dort legt gerade der Geleitverband ab) und vom Handelshafen liegen,
  // sonst träfe das Antippen ein anderes Blatt statt des Konvois.
  const to = { col: cv.to_col as number, row: cv.to_row as number };
  const market = { col: cv.from_col as number, row: cv.from_row as number };
  const now = Date.now();
  const mid = (f: { col: number; row: number }) =>
    convoyPosition({ route: seaRoute(f, to), from: f, to, departAtMs: now - 5 * DAY, arriveAtMs: now + 5 * DAY }, now).at;
  let from: { col: number; row: number } | null = null;
  search: for (let r = to.row - 30; r <= to.row + 30; r++) for (let c = to.col - 30; c <= to.col + 30; c++) {
    const f = { col: c, row: r };
    const d = hexDistanceKm(to, f);
    if (terrainAt(c, r) !== "sea" || d < 300 || d > 900 || seaRoute(f, to).hexes.length < 4) continue;
    const m = hexAtXY(mid(f).x, mid(f).y);
    if (hexDistanceKm(player, m) >= 150 && hexDistanceKm(market, m) >= 100) { from = f; break search; }
  }
  if (!from) throw new Error("Kein Konvoi-Start fern von eigenem Hafen und Handelshafen gefunden");
  await seed.sql`update convoy set from_col = ${from.col}, from_row = ${from.row}, depart_at = ${new Date(now - 5 * DAY).toISOString()}, arrive_at = ${new Date(now + 5 * DAY).toISOString()}, cartel_at = null where id = ${cv.id}`;
  const p = mid(from);
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  const card = page.locator(`[data-convoy="${cv.id}"]`);
  // Seedaten (Konvois) laden nach der Karte: Antippen wiederholen, bis das Konvoi-Blatt erscheint.
  await expect(async () => {
    await tapHex(page, player, hexAtXY(p.x, p.y));
    await expect(card).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await card.getByRole("button", { name: "Probekampf gegen das Kartell" }).click();
  const res = card.locator("[data-convoy-probe-result]");
  await expect(res.getByText(/Kartellgruppe für diese Ladung: \d+ Schnellboote?/)).toBeVisible();
  await expect(res.getByText(/hält in [\d,]+ % der Probekämpfe/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Karte · Konvoi-Blatt mit Probekampf");
  await seed.sql`delete from convoy where id = ${cv.id}`;
});
