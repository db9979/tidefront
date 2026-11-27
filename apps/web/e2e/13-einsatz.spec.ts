// Truppen → Einsatz: Kopf „Flotte daheim“, lohnende Ziele (Nester mit Siegchance) → Angreifen öffnet die Planung
// vorbelegt, laufende Mission als Karte mit Zurückrufen, Kacheln (Admirale, Felder, Vorlagen, Simulator) als Blätter.
// Mit E2E_SHOTS=<Ordner> entstehen Bildschirmfotos der Zustände (430 px breit).
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setBuildings, setUnits } from "./game.ts";

test.use({ spawnNear: "nest", viewport: { width: 430, height: 900 } });

async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  // Hauptbereich scrollt selbst: Fenster kurz so hoch wie der Inhalt, dann zurück.
  const h = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll("main, [role=dialog] > div")).map((e) => e.scrollHeight)));
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.width, height: Math.min(4000, h + 260) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/${name}.png` });
  await page.setViewportSize(vp);
}

async function closeDialog(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("Einsatz: Flotte, Ziele, laufende Mission, Kacheln", async ({ page, player, seed }) => {
  test.slow(); // lange Abläufe; unter Parallel-Last sonst über 60 s
  // Radarstation 8 (470 km): die nächsten Nester liegen sicher in Sicht (Lagebild).
  await setBuildings(seed.sql, player.baseId, { werft: 3, kaserne: 2, hafenkommandantur: 2, kommandozentrale: 3, radarstation: 8, kraftwerk: 6 });
  await setUnits(seed.sql, player.baseId, { korvette: 6, landungsschiff: 2, schuetzen: 30 });

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: /^Einsatz/ }).click();

  // Kopf: Gattungen, Missionsplätze als Punkte, Mission planen
  const head = page.getByRole("region", { name: "Flotte daheim" });
  await expect(head.getByLabel("See: 8 daheim")).toBeVisible();
  await expect(head.getByLabel("Land: 30 daheim")).toBeVisible();
  await expect(head.getByLabel("Missionsplätze 0 von 2 belegt")).toBeVisible();
  await expect(head.getByRole("button", { name: "Mission planen" })).toBeVisible();

  // Leerer Zustand und lohnende Ziele mit Siegchance
  await expect(page.getByText("Alle Schiffe liegen im Hafen.")).toBeVisible();
  const targets = page.locator("section").filter({ has: page.getByRole("heading", { name: "Nester in der Nähe" }) });
  const first = targets.locator("li[data-target]").first();
  await expect(first.getByText(/^Nest Stufe [IV]+$/)).toBeVisible();
  await expect(first.getByText(/^\d+ %$/)).toBeVisible({ timeout: 15000 });
  await expectNoHorizontalOverflow(page, "Einsatz ohne Mission");
  await shot(page, "einsatz-1-ohne-mission");

  // Angreifen: Planung mit Ziel, Art Überfall und vorgeschlagenem Verband
  await first.getByRole("button", { name: "Angreifen" }).click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
  await expect(page.getByText(/Piratennest Stufe \d/)).toBeVisible();
  await expect(page.getByText("Überfall", { exact: true })).toBeVisible();
  const unitRow = (name: string) => page.getByRole("listitem").filter({ hasText: new RegExp(`^${name}\\d`) });
  // Vorschlag aus dem Probekampf: kleinster siegreicher Verband (nicht alles); Truppen mit Landungsschiff.
  await expect(unitRow("Schützen").getByLabel("Anzahl")).not.toHaveValue("0");
  await expect(unitRow("Landungsschiff").getByLabel("Anzahl")).not.toHaveValue("0");
  await page.getByRole("button", { name: "Auslaufen" }).click();
  await expect(page.getByRole("heading", { name: "Mission gestartet" })).toBeVisible();
  await page.getByRole("button", { name: "Fertig" }).click();

  // Laufende Mission als Karte
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await expect(page.getByRole("heading", { name: "Unterwegs 1/2" })).toBeVisible();
  const card = page.locator("li[data-mission]").first();
  await expect(card.getByText("Hinfahrt")).toBeVisible();
  await expect(card.getByText(/^Ankunft in /)).toBeVisible();
  await expect(head.getByLabel("Missionsplätze 1 von 2 belegt")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Einsatz mit Mission");
  await shot(page, "einsatz-2-mission");

  // „Auf der Karte“ öffnet die Missionsleiste einmal; bei späterer Rückkehr zur Karte bleibt sie zu.
  await card.getByRole("button", { name: "Auf der Karte" }).click();
  await expect(page.getByRole("button", { name: "Zeiten" })).toBeVisible();
  await page.getByRole("navigation").getByRole("button", { name: "Basis" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await expect(page.getByRole("button", { name: "Hineinzoomen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zeiten" })).toHaveCount(0);
  // Erneut „Karte“ antippen schließt die offene Missionsleiste; ebenso die Rückkehr nach > 30 s im Hintergrund.
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.locator("li[data-mission]").first().getByRole("button", { name: "Auf der Karte" }).click();
  await expect(page.getByRole("button", { name: "Zeiten" })).toBeVisible();
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await expect(page.getByRole("button", { name: "Zeiten" })).toHaveCount(0);
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.locator("li[data-mission]").first().getByRole("button", { name: "Auf der Karte" }).click();
  await expect(page.getByRole("button", { name: "Zeiten" })).toBeVisible();
  await page.evaluate(() => {
    const vis = (hidden: boolean) => { Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden }); document.dispatchEvent(new Event("visibilitychange")); };
    vis(true);
    const now = Date.now;
    Date.now = () => now() + 31_000;
    vis(false);
    Date.now = now;
  });
  await expect(page.getByRole("button", { name: "Zeiten" })).toHaveCount(0);
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();

  // Zurückrufen über die Karte der Mission
  await card.getByRole("button", { name: "Zurückrufen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Zurückrufen" }).click();
  await expect(card.getByText("zurückgerufen")).toBeVisible();
  await expect(card.getByText(/^Zurück in /)).toBeVisible();

  // Kacheln öffnen die bestehenden Ansichten als Blätter
  await seed.sql`insert into admiral (player_id, base_id, name, xp, spec1) values (${player.id}, ${player.baseId}, 'Testmann', 0, 'angriff')`;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Unterwegs 1/2" })).toBeVisible();
  await shot(page, "einsatz-3-zurueckgerufen-admiral");
  await page.getByRole("button", { name: /^Admirale 1\/\d/ }).click();
  await expect(page.getByRole("dialog").getByText(/Testmann/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "Blatt Admirale");
  await shot(page, "einsatz-4-blatt-admirale");
  await closeDialog(page);
  await page.getByRole("button", { name: /^Rohstofffelder 0\/\d/ }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /^Meine Felder/ })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Blatt Felder");
  await closeDialog(page);
  await page.getByRole("button", { name: /^Vorlagen/ }).click();
  await expect(page.getByRole("dialog").getByText(/Noch keine Vorlagen/)).toBeVisible();
  await closeDialog(page);
  await page.getByRole("button", { name: /^Kampfsimulator/ }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Kampfsimulator" })).toBeVisible();
  await closeDialog(page);
});
