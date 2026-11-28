// App-Hülle nach UX-0.43 (B2/B3/B4/A6): Menü → Einstellungen → Zurück zum Ausgangsort, Einstellungen in vier Gruppen
// (E-Mail-Schalter ohne Mailserver deaktiviert mit Grund, 24-h-Uhrzeit), Verwaltung mit vier Reitern bei 390 und 1440 px
// ohne Überbreite, Desktop-Textansichten ohne Karte in voller Breite, „Karte groß“, Leiste unten, Fortschritts-Chip,
// Tastaturkürzel. Mit TF_UXS_SHOTS=1 entstehen Bildschirmfotos unter /tmp/tf-uxs/.
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

const SHOTS = process.env.TF_UXS_SHOTS ? "/tmp/tf-uxs" : null;
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function menu(page: Page, item: RegExp) {
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: item }).click();
}

/** Kein Element der Kopfleiste ragt aus ihr heraus (Desktop: Rohstoffe, Chip, Menü). */
async function headerFits(page: Page) {
  const r = await page.evaluate(() => {
    const h = document.querySelector("header")!;
    const right = h.getBoundingClientRect().right;
    return Array.from(h.querySelectorAll<HTMLElement>("button")).filter((b) => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().right > right + 1).map((b) => b.textContent?.slice(0, 30));
  });
  expect(r, "Kopfleiste ohne Überbreite").toEqual([]);
}

test.describe("Handy 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Menü → Einstellungen → Zurück führt zum Ausgangsort; vier Gruppen, E-Mail ohne Mailserver mit Grund", async ({ page, player, seed }) => {
    await seed.sql`update player set is_admin = false where id = ${player.id}`;
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
    await expect(page.getByRole("tab", { name: /^Einsatz/ })).toBeVisible();

    await menu(page, /^Einstellungen/);
    await expect(page.getByRole("heading", { name: "Einstellungen", level: 1 })).toBeVisible();
    for (const g of ["Benachrichtigungen", "Spiel", "Konto", "Hilfe"]) await expect(page.getByRole("heading", { name: g, level: 2, exact: true })).toBeVisible();
    // Gruppen-Chips springen zur Gruppe; Nachtschild-Startzeit liegt unter „Spiel“ (24-h-Format).
    await page.getByRole("radiogroup", { name: "Gruppen der Einstellungen" }).getByRole("radio", { name: "Spiel" }).click();
    const night = page.getByLabel(/Nachtschild \(\d+ Stunden täglich\) beginnt/);
    await expect(night).toBeVisible();
    await expect(night.locator("option", { hasText: "um 07:00 Uhr" })).toHaveCount(1);
    // Ruhezeit-Auswahl im 24-h-Format, ohne AM/PM.
    await expect(page.getByRole("combobox", { name: "Ruhezeit von" }).locator("option").nth(7)).toHaveText("07:00");
    // E2E-Server hat keinen Mailversand: E-Mail-Arten deaktiviert und mit Grund.
    await page.getByRole("radio", { name: "Benachrichtigungen" }).click();
    const mailCard = page.locator("#einstellungen-mailarten");
    await expect(mailCard.getByText(/nicht eingerichtet|Adresse eintragen|bestätigen/).first()).toBeVisible();
    if ((await mailCard.getByRole("switch").count()) === 0) await mailCard.getByRole("button", { name: /E-Mail-Benachrichtigungen/ }).click();
    await expect(mailCard.getByRole("switch").first()).toBeDisabled();
    // Freunde einladen, Fehler melden und Verwaltung stehen nicht (mehr) als Karten in den Einstellungen.
    await expect(page.getByRole("heading", { name: "Freunde einladen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Verwaltung öffnen" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "Einstellungen");
    await shot(page, "m-einstellungen");

    // Zurück (Knopf) → Truppen, nicht Handbuch.
    await page.getByRole("button", { name: "Zurück" }).click();
    await expect(page.getByRole("heading", { name: "Einstellungen", level: 1 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Handbuch" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Einsatz/ })).toBeVisible();

    // Browser-Zurück ebenso.
    await menu(page, /^Einstellungen/);
    await expect(page.getByRole("heading", { name: "Einstellungen", level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Einstellungen", level: 1 })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Einsatz/ })).toBeVisible();

    // Menü: jeder Eintrag einmal, Freunde einladen als Blatt.
    await page.getByRole("button", { name: "Menü", exact: true }).click();
    const sheet = page.getByRole("dialog");
    for (const n of [/^Handbuch/, /^Einstellungen/, /^Freunde einladen/, /^Fehler melden/, /^Abmelden/]) await expect(sheet.getByRole("button", { name: n })).toHaveCount(1);
    await sheet.getByRole("button", { name: /^Freunde einladen/ }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Freunde einladen" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Verwaltung: vier Reiter, Gefahrenzone getrennt, keine Überbreite", async ({ page, player, seed }) => {
    await seed.sql`update player set is_admin = true where id = ${player.id}`;
    await page.goto("/");
    await menu(page, /^Verwaltung/);
    const tabs = page.getByRole("tablist", { name: "Verwaltung" }).getByRole("tab");
    await expect(tabs).toHaveText(["Übersicht", "Spieler", "Welt", "Statistik"]);
    // Alle vier Reiter passen nebeneinander in die Breite.
    for (let i = 0; i < 4; i++) {
      const b = (await tabs.nth(i).boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    await expect(page.getByRole("heading", { name: "Ampel" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Einrichtung/ })).toHaveAttribute("aria-expanded", "false");
    await expectNoHorizontalOverflow(page, "Verwaltung · Übersicht");
    await shot(page, "m-verwaltung-uebersicht");
    await page.getByRole("tab", { name: "Spieler" }).click();
    await expect(page.getByRole("heading", { name: /^Spieler \(\d+\)/ })).toBeVisible();
    await page.getByRole("searchbox", { name: "Spieler suchen" }).fill(player.name);
    await expect(page.getByText(player.name, { exact: false }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page, "Verwaltung · Spieler");
    await shot(page, "m-verwaltung-spieler");
    await page.getByRole("tab", { name: "Welt" }).click();
    const danger = page.getByTestId("admin-gefahrenzone");
    await expect(danger.getByRole("heading", { name: "Gefahrenzone" })).toBeVisible();
    await expect(danger.getByRole("heading", { name: "Kartell-Stärke" })).toBeVisible();
    await expect(danger.getByRole("switch", { name: "Kartennebel" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "Verwaltung · Welt");
    await shot(page, "m-verwaltung-welt");
    await page.getByRole("tab", { name: "Statistik" }).click();
    await expect(page.getByRole("radiogroup", { name: "Zeitraum" })).toBeVisible();
    await expect(page.getByTestId("admin-gefahrenzone")).toHaveCount(0); // Not-Aus nicht zwischen den Statistiken
    await expect(page.getByRole("button", { name: "Ausschalten" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "Verwaltung · Statistik");
    await shot(page, "m-verwaltung-statistik");
    // Gewählter Reiter bleibt nach Neuladen (?view=admin).
    await page.reload();
    await expect(page.getByRole("tab", { name: "Statistik" })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Desktop 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test("Textansichten ohne Karte in voller Breite, „Karte groß“, Leiste unten, Fortschritts-Chip", async ({ page, player, seed }) => {
    test.setTimeout(120_000);
    await seed.sql`update player set is_admin = true where id = ${player.id}`;
    await page.goto("/");
    const side = page.getByTestId("desktop-side");
    const map = page.getByTestId("desktop-map");
    await expect(side.getByTestId("lage-tab")).toBeVisible();
    await expect(map).toBeVisible();
    // Kopfleiste: Rohstoffe gruppiert mit Namen, Fortschritts-Chip, nichts ragt heraus.
    await expect(page.getByRole("group", { name: "Rohstoffe" }).getByRole("button")).toHaveCount(4);
    await expect(page.getByRole("group", { name: "Rohstoffe" })).toContainText("Stahl");
    // Die Rangliste rechnet der Server höchstens alle 30 s neu: ein eben angelegter Spieler erscheint ggf. erst danach.
    let first = true;
    await expect(async () => {
      if (!first) await page.reload(); // nach Ablauf des Server-Zwischenspeichers neu laden
      first = false;
      await expect(page.getByTestId("progress-chip")).toContainText(/Platz \d+ von \d+/, { timeout: 15000 });
    }).toPass({ intervals: [32_000], timeout: 95_000 });
    await headerFits(page);
    await shot(page, "d-basis");

    // Leiste unten: Saison, Handbuch, Einstellungen, Verwaltung (Admin).
    const rail = page.getByTestId("nav-rail");
    for (const id of ["saison", "handbuch", "settings", "admin"]) await expect(rail.getByTestId(`rail-${id}`)).toBeVisible();

    for (const [id, heading] of [["handbuch", "Handbuch"], ["settings", "Einstellungen"], ["admin", "Verwaltung"]] as const) {
      await rail.getByTestId(`rail-${id}`).click();
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      await expect(rail.getByTestId(`rail-${id}`)).toHaveAttribute("aria-current", "page");
      await expect(map).toBeHidden();
      await expect(side).toHaveAttribute("data-text-view", "true");
      const box = (await side.boundingBox())!;
      expect(box.width, `${heading}: volle Breite`).toBeGreaterThan(1200);
      await expectNoHorizontalOverflow(page, `Desktop · ${heading}`);
      await headerFits(page);
      await shot(page, `d-${id}`);
    }
    // Einstellungen am Desktop zweispaltig.
    await rail.getByTestId("rail-settings").click();
    const notify = (await page.getByRole("heading", { name: "Benachrichtigungen", level: 2, exact: true }).boundingBox())!;
    const game = (await page.getByRole("heading", { name: "Spiel", level: 2, exact: true }).boundingBox())!;
    expect(game.x).toBeGreaterThan(notify.x + 300);
    expect(Math.abs(game.y - notify.y)).toBeLessThan(40);
    // Verwaltung: alle Reiter ohne Überbreite.
    await rail.getByTestId("rail-admin").click();
    for (const t of ["Übersicht", "Spieler", "Welt", "Statistik"]) {
      await page.getByRole("tab", { name: t }).click();
      await expectNoHorizontalOverflow(page, `Desktop · Verwaltung · ${t}`);
      await shot(page, `d-verwaltung-${t.toLowerCase().replace("ü", "ue")}`);
    }

    // „Karte groß“ holt die Karte über die Textansicht; erneut tippen kehrt zur Verwaltung zurück.
    const big = rail.getByRole("button", { name: /^Karte groß/ });
    await expect(big).toHaveAttribute("aria-pressed", "false");
    await big.click();
    await expect(big).toHaveAttribute("aria-pressed", "true");
    await expect(map).toBeVisible();
    await expect(map.locator("canvas").first()).toBeVisible();
    await expect(side).toHaveCount(0);
    expect((await map.boundingBox())!.width).toBeGreaterThan(1200);
    await shot(page, "d-karte-gross");
    await big.click();
    await expect(page.getByRole("heading", { name: "Verwaltung", level: 1 })).toBeVisible();
    await expect(map).toBeHidden();

    // Saison (Rangliste) ist am Desktop ebenfalls Textansicht; der Chip führt dorthin.
    await page.getByTestId("progress-chip").click();
    await expect(rail.getByTestId("rail-saison")).toHaveAttribute("aria-current", "page");
    await expect(side).toHaveAttribute("data-text-view", "true");
    await expect(map).toBeHidden();
    await shot(page, "d-saison");

    // Spielreiter haben wieder Karte + Seitenleiste.
    await rail.getByRole("button", { name: /^Truppen/ }).click();
    await expect(map).toBeVisible();
    await expect(side).not.toHaveAttribute("data-text-view", "true");
    expect((await side.boundingBox())!.width).toBeLessThan(600);
  });

  test("Tastaturkürzel: 1–5 Reiter, ? und „,“ öffnen Ansichten, Esc schließt, M schaltet die Karte, nicht beim Tippen", async ({ page, player }) => {
    void player;
    await page.goto("/");
    const rail = page.getByTestId("nav-rail");
    await expect(page.getByTestId("lage-tab")).toBeVisible();
    await page.keyboard.press("3");
    await expect(rail.getByRole("button", { name: /^Truppen/ })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("5");
    await expect(rail.getByRole("button", { name: /^Börse/ })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("4");
    await expect(rail.getByRole("button", { name: /^Meldungen/ })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("1");
    await expect(rail.getByRole("button", { name: /^Basis/ })).toHaveAttribute("aria-current", "page");

    await page.keyboard.press("?");
    await expect(page.getByRole("heading", { name: "Handbuch", level: 1 })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Handbuch", level: 1 })).toHaveCount(0);
    await expect(page.getByTestId("lage-tab")).toBeVisible();

    await page.keyboard.press(",");
    await expect(page.getByRole("heading", { name: "Einstellungen", level: 1 })).toBeVisible();
    // Beim Tippen in ein Feld greifen Kürzel nicht.
    const mail = page.locator("#tf-email");
    if (await mail.count()) {
      await mail.fill("");
      await mail.type("3?");
      await expect(page.getByRole("heading", { name: "Einstellungen", level: 1 })).toBeVisible();
      await mail.blur();
    }
    // Esc schließt zuerst ein offenes Blatt, dann die Ansicht.
    await page.getByRole("button", { name: "Was ist neu?" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Einstellungen", level: 1 })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Einstellungen", level: 1 })).toHaveCount(0);

    // M: Karte groß ein und aus.
    const big = rail.getByRole("button", { name: /^Karte groß/ });
    await page.keyboard.press("m");
    await expect(big).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("m");
    await expect(big).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("lage-tab")).toBeVisible();
    // Reiter-Knöpfe nennen ihr Kürzel.
    await expect(rail.getByRole("button", { name: /^Basis/ })).toHaveAttribute("aria-keyshortcuts", "1");
  });
});
