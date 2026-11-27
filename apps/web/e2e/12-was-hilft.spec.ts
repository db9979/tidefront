// „Was hilft?“: Ablehnungsgründe mit Abhilfe und Sprung dorthin (Missionsplätze → Hafenkommandantur,
// fehlende Ressourcen beim Ausbau → Börse mit vorgewählter Ressource).
import { hexDistanceKm } from "@tidefront/world";
import { awayFromEdge, expect, expectNoHorizontalOverflow, tapHex, test } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

test.describe("Missionsplätze", () => {
  test.use({ spawnNear: "nest" });

  test("Alle Missionsplätze belegt → Was hilft? → Hafenkommandantur", async ({ page, player, seed }) => {
    test.slow(); // ~20 s allein, unter voller Parallel-Last sonst über 60 s
    await setBuildings(seed.sql, player.baseId, { werft: 3, kaserne: 2, hafenkommandantur: 1, kommandozentrale: 3 });
    await setUnits(seed.sql, player.baseId, { korvette: 6, landungsschiff: 2 });
    const nest = (await seed.sql`select col, row from nest where defeated_at is null`)
      .map((n) => ({ col: n.col as number, row: n.row as number, d: hexDistanceKm(player, { col: n.col as number, row: n.row as number }) }))
      .filter(awayFromEdge)
      .sort((a, b) => a.d - b.d)[0];
    const unitRow = (name: string) => page.getByRole("listitem").filter({ hasText: new RegExp(`^${name}\\d`) });
    const planAtNest = async () => {
      await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
      await tapHex(page, player, nest);
      await page.getByRole("button", { name: "Mission planen" }).click();
      await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
    };

    // Erste Mission belegt den einzigen Platz (Hafenkommandantur Stufe 1).
    await page.goto("/");
    await planAtNest();
    await unitRow("Korvette").getByRole("button", { name: "alle" }).click();
    // Nur Korvetten, keine Landung: Probekampf unter 10 % → Rückfrage „aussichtslos“ (TST-05), hier bewusst bestätigen.
    page.once("dialog", (d) => { expect(d.message()).toContain("aussichtslos"); void d.accept(); });
    await page.getByRole("button", { name: "Auslaufen" }).click();
    await expect(page.getByRole("heading", { name: "Mission gestartet" })).toBeVisible();
    await page.getByRole("button", { name: "Fertig" }).click();

    // Zweite Planung: Vorschau und Aktionsleiste nennen den Grund mit „Was hilft?“.
    await planAtNest();
    await unitRow("Landungsschiff").getByRole("button", { name: "alle" }).click();
    const preview = page.locator("section").filter({ has: page.getByRole("heading", { name: "Vorschau" }) });
    await expect(preview.getByText("Alle Missionsplätze sind belegt.")).toBeVisible();
    await preview.getByRole("button", { name: /Was hilft/ }).click();
    const hint = preview.locator("[data-remedy]");
    await expect(hint).toContainText("1 von 1 belegt"); // Kurzfassung im Kopf
    await expect(hint).toContainText("Stufe 2 gibt 2 Plätze (jetzt Stufe 1)");
    await expect(hint.getByRole("button", { name: "Laufende Missionen" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "Missionsplanung mit „Was hilft?“");

    // Grauer „Auslaufen“-Knopf: Antippen zeigt den Hinweis über der Leiste statt nichts zu tun.
    await preview.getByRole("button", { name: /Was hilft/ }).click();
    const launch = page.getByRole("button", { name: "Auslaufen" });
    await expect(launch).toHaveAttribute("aria-disabled", "true");
    await launch.click({ force: true });
    const barHint = page.locator("#tf-actionbar [data-remedy]");
    await expect(barHint).toContainText("1 von 1 belegt");
    await expectNoHorizontalOverflow(page, "Aktionsleiste mit Hinweis");

    // Sprung: Basis mit dem Blatt der Hafenkommandantur.
    await barHint.getByRole("button", { name: "Hafenkommandantur ausbauen" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: /^Hafenkommandantur/ })).toBeVisible();
    await expect(sheet.getByText("Missionsplätze jetzt: 1")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mission planen" })).toHaveCount(0);
  });
});

test("Fehlende Ressourcen beim Ausbau → Was hilft? → Börse mit Elektronik", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3 });
  await setResources(seed.sql, player.baseId, { stahl: 3000, treibstoff: 1000, elektronik: 0 });

  await page.goto("/?sub=hafen");
  await page.getByRole("button", { name: /^Kraftwerk 0/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Noch nicht genug Ressourcen.")).toBeVisible();

  // Der graue Ausbau-Knopf klappt den Hinweis auf.
  const up = sheet.getByRole("button", { name: "Ausbau auf 1" });
  await expect(up).toHaveAttribute("aria-disabled", "true");
  await up.click({ force: true });
  const hint = sheet.locator("[data-remedy]");
  await expect(hint).toContainText(/Fehlt: \d+ Elektronik/); // Kurzfassung im Kopf
  await expect(hint).toContainText(/\d+ \/ \d+/); // Fortschrittszeile Bestand / Bedarf
  await expect(hint).toContainText(/an der Börse/);
  await expectNoHorizontalOverflow(page, "Gebäudeblatt mit „Was hilft?“");

  // Sprung zur Börse, Elektronik ist vorgewählt.
  await hint.getByRole("button", { name: "Elektronik an der Börse" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Börse", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order Elektronik" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Börse nach Sprung");
});
