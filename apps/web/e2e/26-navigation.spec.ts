// Navigationsumbau (nach 0.38): Startseite Basis → Lage mit „Alle abholen“, eine Zahl je Reiter mit Textalternative,
// Basis → Hafen bleibt nach Neuladen, Karte mit „Sichtungen“ und Wetter standardmäßig aus, Desktop-Layout ab 1024 px
// (Leiste links, Karte immer sichtbar, Seitenleiste rechts). Mit TF_NAV_SHOTS=1 entstehen Bildschirmfotos unter
// /tmp/tf-nav/ (Handy 390 px, Desktop 1440 px).
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

const DONE_1_TO_5 = { kraftwerk: 1, stahlwerk: 1, raffinerie: 1, versorgungshof: 1, kommandozentrale: 1, kaserne: 1 };
const SHOTS = process.env.TF_NAV_SHOTS ? "/tmp/tf-nav" : null;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("Startseite Lage: Alle abholen, eine Zahl je Reiter, Hafen bleibt nach Neuladen", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, DONE_1_TO_5);
  await setResources(seed.sql, player.baseId, { stahl: 1000, treibstoff: 500, elektronik: 300, proviant: 1000 });
  await page.goto("/");

  // Startseite ist Basis → Lage („Was steht an?“) mit den Aufträgen.
  await expect(page.getByTestId("nav-bottom")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Basis" }).getByRole("tab", { name: /^Lage/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("lage-tab")).toBeVisible();
  const quests = page.getByRole("region", { name: "Aufträge" });
  await expect(quests.getByRole("button", { name: /^Auftragsbuch: 5\/11, 5 abholbereit$/ })).toBeVisible();
  // Eine Zahl je Reiter: Meldungen ohne Ungelesenes trägt keine Zahl; Truppen, Karte, Börse nie.
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("button", { name: "Meldungen", exact: true })).toBeVisible();
  for (const t of ["karte", "truppen", "boerse", "berichte"]) await expect(page.getByTestId(`nav-badge-${t}`)).toHaveCount(0);
  await expectNoHorizontalOverflow(page, "Basis · Lage");
  await shot(page, "m-basis-lage");

  // Alle abholen: eine Aktion, danach nichts mehr abholbereit (Belohnungsquellen werden einzeln genannt).
  const waiting = page.getByTestId("lage-waiting");
  await expect(waiting.locator('[data-lage-key="belohnung:quests"]')).toContainText(/im Auftragsbuch/);
  const all = waiting.getByRole("button", { name: /^Alle abholen \(\d+\)$/ });
  await expect(all).toBeVisible();
  await all.click();
  await expect(page.getByTestId("claim-all-note")).toContainText(/Belohnungen abgeholt/);
  await expect(quests.getByRole("button", { name: /^Auftragsbuch: 5\/11$/ })).toBeVisible();
  const [c] = await seed.sql`select count(*)::int as n from guide_claim where player_id = ${player.id}`;
  expect(c.n).toBe(5);

  // Basis → Hafen: Bauhof und Gebäude; Neuladen bleibt auf dem Hafen.
  await page.getByRole("tablist", { name: "Basis" }).getByRole("tab", { name: /^Hafen/ }).click();
  await expect(page.getByRole("heading", { name: "Bauhof" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Basis · Hafen");
  await shot(page, "m-basis-hafen");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Bauhof" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("sub")).toBe("hafen");
});

test("Karte: Wetter standardmäßig aus, Sichtungen-Blatt, Legende mit „?“-Raute", async ({ page, player }) => {
  void player;
  await page.goto("/?tab=karte");
  await expect(page.locator("main canvas").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Wetter einblenden" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: /Legende/ }).first().click();
  await expect(page.getByText("Piratennest, Stufe unbekannt (keine Sicht) – erst aufklären")).toBeVisible();
  await shot(page, "m-karte-legende");
  await page.keyboard.press("Escape");
  await page.getByTestId("map-sichtungen").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Sichtungen", exact: true }).first()).toBeVisible(); // Blatttitel; die Liste kann eine gleichnamige Zwischenüberschrift tragen
  await expect(sheet.getByTestId("lagebild-tab")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Karte · Sichtungen");
  await shot(page, "m-karte-sichtungen");
});

test("Truppen: Nester in der Nähe – unbekannte Stufe zuerst aufklären", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { ...DONE_1_TO_5, werft: 1 });
  await setUnits(seed.sql, player.baseId, { korvette: 2, landungsschiff: 1, schuetzen: 30 });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Nester in der Nähe" }) });
  await expect(card).toBeVisible();
  // Jede Zeile mit unbekannter Stufe hat „Aufklären“ als Hauptknopf (erster, breiter Knopf).
  const unknown = card.locator("li[data-target]").filter({ hasText: "Stufe unbekannt" });
  for (let i = 0; i < (await unknown.count()); i++) await expect(unknown.nth(i).getByRole("button").filter({ hasText: /^(Aufklären|Angreifen)$/ }).first()).toHaveText("Aufklären");
  await expectNoHorizontalOverflow(page, "Truppen · Nester in der Nähe");
  await shot(page, "m-truppen-nester");
  await page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ }).click();
  await shot(page, "m-meldungen");
});

test.describe("Desktop 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test("Leiste links, Karte immer sichtbar, Reiter in der Seitenleiste, Feldblatt rechts", async ({ page, player }) => {
    void player;
    await page.goto("/");
    await expect(page.locator('[data-layout="desktop"]')).toBeVisible();
    await expect(page.getByTestId("nav-rail")).toBeVisible();
    await expect(page.getByTestId("nav-bottom")).toHaveCount(0);
    const map = page.getByTestId("desktop-map");
    const side = page.getByTestId("desktop-side");
    await expect(map.locator("canvas").first()).toBeVisible();
    await expect(side.getByTestId("lage-tab")).toBeVisible();
    // Leiste links neben der Karte, Seitenleiste rechts daneben.
    const railBox = (await page.getByTestId("nav-rail").boundingBox())!;
    const mapBox = (await map.boundingBox())!;
    const sideBox = (await side.boundingBox())!;
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(mapBox.x + 1);
    expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(sideBox.x + 1);
    expect(mapBox.width).toBeGreaterThan(600);
    await expectNoHorizontalOverflow(page, "Desktop · Basis");
    await shot(page, "d-basis-lage");

    // Andere Reiter erscheinen rechts, die Karte bleibt.
    for (const name of ["Truppen", "Meldungen", "Börse"]) {
      await page.getByTestId("nav-rail").getByRole("button", { name: new RegExp(`^${name}`) }).click();
      await expect(side.getByRole("tablist").first()).toBeVisible();
      await expect(map.locator("canvas").first()).toBeVisible();
      await shot(page, `d-${name.toLowerCase().replace("ö", "oe")}`);
    }

    // Antippen der Karte aus einem anderen Reiter wechselt zu „Karte“: Feldblatt als rechte Seitenleiste.
    const box = (await map.locator("canvas").first().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("map-side")).toBeVisible();
    await expect(page.getByTestId("map-side")).toContainText(/Feld \d+\/\d+/);
    await expect(side).toHaveCount(0);
    // Am Desktop ist „Karte“ der Umschalter „Karte groß“ (UX-0.43 B4): gedrückt statt aktueller Seite.
    await expect(page.getByTestId("nav-rail").getByRole("button", { name: /^Karte groß/ })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "d-karte-feldblatt");

    // Blätter öffnen am Desktop als rechte Schublade.
    await page.keyboard.press("Escape");
    await page.getByTestId("map-sichtungen").click();
    const dlgBox = (await page.getByRole("dialog").locator(".sheet-in").boundingBox())!;
    expect(dlgBox.x + dlgBox.width).toBeGreaterThan(1430);
    expect(dlgBox.height).toBeGreaterThan(800);
    await shot(page, "d-karte-sichtungen");
  });
});
