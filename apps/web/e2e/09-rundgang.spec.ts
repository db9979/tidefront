// Rundgang durch alle Bildschirme mit einem gut ausgebauten Hafen: jedes Gebäudeblatt, Kopfleisten-Blätter,
// Truppen, Forschung, Kampfsimulator, Missionsarten, Karte, Börse. Geprüft: Layout bei 390 px (gesammelt, damit
// ein Lauf alle Fundstellen zeigt) und Konsolenfehler.
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalOverflow, openHafen, test } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

const LEVELS = {
  kommandozentrale: 6, stahlwerk: 6, raffinerie: 5, chipfabrik: 5, versorgungshof: 5, kraftwerk: 6, windpark: 3, solarfeld: 3,
  speicherwerk: 2, lagerkomplex: 6, tiefbunker: 3, werft: 6, kaserne: 5, flugfeld: 4, radarstation: 3, hafenkommandantur: 5,
  forschungsamt: 3, nachrichtendienst: 3,
};

const check = (page: Page, label: string) => expectNoHorizontalOverflow(page, label, { soft: true });

async function closeDialog(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("Rundgang durch alle Bildschirme", async ({ page, player, seed }) => {
  test.slow();
  await setBuildings(seed.sql, player.baseId, LEVELS);
  await setResources(seed.sql, player.baseId, { stahl: 20000, treibstoff: 12000, elektronik: 8000, proviant: 12000 });
  await setUnits(seed.sql, player.baseId, { korvette: 12, zerstoerer: 4, landungsschiff: 3, uboot: 2, schuetzen: 80, kampfpanzer: 3, abfangjaeger: 2, aufklaerungsdrohne: 2 });

  await page.goto("/");
  await expect(page.getByTestId("lage-tab")).toBeVisible();
  await check(page, "Basis · Lage");
  await openHafen(page);
  await expect(page.getByRole("heading", { name: "Bauhof" })).toBeVisible();
  await check(page, "Basis · Hafen (ausgebaut)");

  // Ressourcenleiste
  for (const r of ["Stahl", "Treibstoff", "Elektronik", "Proviant"]) {
    await page.getByRole("button", { name: new RegExp(`^${r} [\\d.]+, .* – Details$`) }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await check(page, `Ressourcenblatt ${r}`);
    await closeDialog(page);
  }

  // Jedes Gebäudeblatt
  for (const id of Object.keys(LEVELS)) {
    const btn = page.locator("main").getByRole("button", { name: new RegExp(`^${label(id)} \\d+`) }).first();
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await check(page, `Gebäudeblatt ${label(id)}`);
    await closeDialog(page);
  }

  // Versorgung, Schutz (Hafen); Aufträge (Lage)
  for (const name of [/^Versorgung /, /^Schutz /, /^Auftragsbuch:/, /^Tagesbefehle:/, /^Wochenziele:/]) {
    if (name.source === "^Auftragsbuch:") await page.getByRole("tablist", { name: "Basis" }).getByRole("tab", { name: /^Lage/ }).click();
    const b = page.locator("main").getByRole("button", { name }).first();
    await expect(b).toBeVisible();
    await b.click();
    await page.waitForTimeout(200);
    await check(page, `Basis · ${name.source}`);
    if ((await page.getByRole("dialog").count()) > 0) await closeDialog(page);
  }

  // Truppen: alle Unterreiter, Forschung, Kampfsimulator
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  for (const t of ["Einsatz", "Ausbilden", "Abwehr"]) {
    await page.getByRole("tab", { name: new RegExp(`^${t}`) }).click();
    await check(page, `Truppen · ${t}`);
  }
  await page.getByRole("tab", { name: /^Einsatz/ }).click();
  await page.getByRole("button", { name: /^Kampfsimulator/ }).click();
  await page.waitForTimeout(300);
  await check(page, "Kampfsimulator");
  if ((await page.getByRole("dialog").count()) > 0) await closeDialog(page);
  await page.getByRole("button", { name: /^Admirale/ }).click();
  await check(page, "Admirale");
  if ((await page.getByRole("dialog").count()) > 0) await closeDialog(page);

  await page.locator("main").getByRole("button", { name: "Forschung" }).first().click();
  await expect(page.getByRole("heading", { name: "Forschung" })).toBeVisible();
  const branches = page.getByRole("tablist", { name: "Forschungszweige" }).getByRole("tab");
  for (let i = 0; i < (await branches.count()); i++) {
    await branches.nth(i).click();
    await check(page, `Forschung · Zweig ${i + 1}`);
  }
  await page.getByRole("button", { name: "Zurück" }).click();

  // Missionsplanung: jede Art einmal
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("button", { name: "Mission planen" }).click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
  await check(page, "Missionsplanung");
  const types = ["Überfall", "Aufklärung", "Transport", "Spionage", "Stationieren", "Minen legen", "Minen räumen", "Blockade", "Gründen"];
  for (const t of types) {
    const change = page.getByRole("button", { name: "ändern" });
    if (await change.count()) await change.click();
    const more = page.getByRole("button", { name: /^Weitere Missionsarten/ });
    if (await more.count()) await more.click();
    const opt = page.locator("main").getByRole("button", { name: new RegExp(`^${t}`) }).first();
    if ((await opt.count()) === 0) continue;
    await opt.click();
    await page.waitForTimeout(150);
    await check(page, `Missionsplanung · ${t}`);
  }
  await page.getByRole("button", { name: "Zurück" }).click();

  // Karte: eigener Hafen, Legende, Wetter umschalten
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await page.getByRole("button", { name: "Mein Hafen" }).click();
  await check(page, "Karte · Mein Hafen");
  await page.getByRole("button", { name: "Wetter einblenden" }).click(); // standardmäßig aus (UI-05)
  await page.getByRole("button", { name: /^Wetter am Hafen/ }).click(); // Wetterkärtchen aufklappen
  await expect(page.getByText(/^Am Hafen:/)).toBeVisible();
  await check(page, "Karte · Wetter aufgeklappt");
  await page.getByRole("button", { name: /^Wetter am Hafen/ }).click();
  await page.getByRole("button", { name: "Wetter ausblenden" }).click();
  await check(page, "Karte · Wetter aus");
  await page.getByRole("button", { name: "Wetter einblenden" }).click();
  await page.getByRole("button", { name: "Legende öffnen" }).click();
  await check(page, "Karte · Legende");
  await page.getByRole("button", { name: /Legende schließen/ }).click();
  await page.getByTestId("map-sichtungen").click();
  await check(page, "Karte · Sichtungen");
  await closeDialog(page);

  // Meldungen: alle Unterreiter, Rangliste mit Bilanz und Erfolgen
  await page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ }).click();
  for (const t of ["Berichte", "Nachrichten", "Allianz", "Rangliste"]) {
    await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: new RegExp(`^${t}`) }).click();
    await check(page, `Meldungen · ${t}`);
  }
  for (const t of ["Bilanz", "Erfolge"]) {
    await page.getByRole("tablist", { name: "Rangliste" }).getByRole("tab", { name: new RegExp(`^${t}`) }).click();
    await check(page, `Meldungen · Rangliste · ${t}`);
  }

  // Börse: jede Ressource
  await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
  await page.getByRole("tab", { name: "Handel" }).click();
  for (const r of ["Stahl", "Treibstoff", "Elektronik", "Proviant"]) {
    await page.getByRole("radio", { name: new RegExp(`^${r}:`) }).click();
    await check(page, `Börse · ${r}`);
  }
  await page.getByRole("button", { name: /^Kursverlauf/ }).click();
  await check(page, "Börse · Kursverlauf");
});

function label(id: string): string {
  const L: Record<string, string> = {
    kommandozentrale: "Kommandozentrale", stahlwerk: "Stahlwerk", raffinerie: "Raffinerie", chipfabrik: "Chipfabrik",
    versorgungshof: "Versorgungshof", kraftwerk: "Kraftwerk", windpark: "Windpark", solarfeld: "Solarfeld", speicherwerk: "Speicherwerk",
    lagerkomplex: "Lagerkomplex", tiefbunker: "Tiefbunker", werft: "Werft", kaserne: "Kaserne", flugfeld: "Flugfeld",
    radarstation: "Radarstation", hafenkommandantur: "Hafenkommandantur", forschungsamt: "Forschungsamt", nachrichtendienst: "Nachrichtendienst",
  };
  return L[id];
}
