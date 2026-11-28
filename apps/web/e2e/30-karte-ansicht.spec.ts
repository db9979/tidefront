// Kartenansicht (nach 0.46): eine einheitliche Bedienleiste rechts oben (Zoom als Gruppe, „Mein Hafen“, „Sichtungen“,
// „Ebenen“ als gleich große Symbolknöpfe mit Namen), nichts überlappt (Wetterkärtchen, Feindwarnung, Positionsanzeige),
// Kurszeile auf dem Kartenreiter am Handy ausgeblendet. Mit TF_KARTE_SHOTS=<Präfix> entstehen Bildschirmfotos unter
// /tmp/tf-karte/ (Handy 390 × 844, Desktop 1440 × 900).
import { mkdirSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

const PREFIX = process.env.TF_KARTE_SHOTS ?? null;

async function shot(page: Page, name: string): Promise<void> {
  if (!PREFIX) return;
  mkdirSync("/tmp/tf-karte", { recursive: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `/tmp/tf-karte/${PREFIX}-${name}.png` });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Die fünf Knöpfe der Kartenleiste: gleich groß, mindestens 44 px, mit zugänglichem Namen und Tooltip. */
async function checkToolbar(page: Page): Promise<Box[]> {
  const bar = page.getByRole("toolbar", { name: "Kartensteuerung" });
  await expect(bar).toBeVisible();
  const buttons: Locator[] = [
    bar.getByRole("button", { name: "Hineinzoomen" }),
    bar.getByRole("button", { name: "Herauszoomen" }),
    bar.getByRole("button", { name: "Mein Hafen" }),
    page.getByTestId("map-sichtungen"),
    page.getByTestId("map-ebenen"),
  ];
  await expect(page.getByTestId("map-sichtungen")).toHaveAccessibleName("Sichtungen");
  await expect(page.getByTestId("map-ebenen")).toHaveAccessibleName("Ebenen und Legende");
  const boxes: Box[] = [];
  for (const b of buttons) {
    await expect(b).toBeVisible();
    await expect(b).toHaveAttribute("title", /.+/);
    boxes.push((await b.boundingBox())!);
  }
  for (const bx of boxes) {
    expect(Math.round(bx.width)).toBe(Math.round(boxes[0].width));
    expect(Math.round(bx.height)).toBe(Math.round(boxes[0].height));
    expect(bx.width).toBeGreaterThanOrEqual(44);
    expect(bx.height).toBeGreaterThanOrEqual(44);
  }
  // Eine schmale Spalte: alle Knöpfe bündig übereinander, ohne Überlappung.
  for (let i = 1; i < boxes.length; i++) {
    expect(Math.abs(boxes[i].x - boxes[0].x)).toBeLessThan(1);
    expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1.5);
  }
  return boxes;
}

test("Handy 390 × 844: einheitliche Kartenleiste, Kurszeile aus, nichts überlappt", async ({ page, player }) => {
  void player;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { localStorage.setItem("tf-kurszeile", "oben"); localStorage.setItem("tf-wetter", "an"); });
  await page.goto("/?tab=karte");
  const canvas = page.locator("main canvas").first();
  await expect(canvas).toBeVisible();
  await shot(page, "handy-karte");

  // Kurszeile („Immer oben“) gehört nicht über die ganzflächige Karte; auf den anderen Reitern bleibt sie.
  await expect(page.getByRole("button", { name: "Kurszeile – zur Börse" })).toHaveCount(0);
  const boxes = await checkToolbar(page);
  const bar = (await page.getByRole("toolbar", { name: "Kartensteuerung" }).boundingBox())!;
  const map = (await canvas.boundingBox())!;
  // Schmal: höchstens 52 px breit, rechts innerhalb der Karte.
  expect(bar.width).toBeLessThanOrEqual(52);
  expect(bar.x + bar.width).toBeLessThanOrEqual(map.x + map.width);
  // Wetterkärtchen links oben, nicht unter der Leiste.
  const chip = (await page.getByRole("button", { name: /^Wetter am Hafen/ }).boundingBox())!;
  for (const b of boxes) expect(overlaps(chip, b)).toBe(false);
  expect(chip.y).toBeGreaterThanOrEqual(map.y);
  await expectNoHorizontalOverflow(page, "Karte 390");

  // Feld antippen: Positionsanzeige und Feldblatt überdecken die Leiste nicht.
  await page.mouse.click(map.x + map.width * 0.35, map.y + map.height * 0.6);
  await expect(page.getByRole("button", { name: "Schließen" })).toBeVisible();
  const pos = (await page.getByTestId("map-position").boundingBox())!;
  for (const b of await checkToolbar(page)) expect(overlaps(pos, b)).toBe(false);
  await shot(page, "handy-feldblatt");
  await page.getByRole("button", { name: "Schließen" }).click();

  await page.getByTestId("map-ebenen").click();
  await expect(page.getByRole("dialog").getByTestId("map-legend")).toBeVisible();
  await shot(page, "handy-ebenen");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByTestId("map-sichtungen").click();
  await expect(page.getByRole("dialog").getByTestId("lagebild-tab")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0); // Blatt ganz zu, sonst fängt der Hintergrund den Tipp ab

  // Auf einem anderen Reiter ist die Kurszeile weiter da.
  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("button", { name: "Truppen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kurszeile – zur Börse" })).toBeVisible();
});

test.describe("Desktop 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test("Kartenleiste neben der Seitenleiste, ohne doppelte Bedienung", async ({ page, player }) => {
    void player;
    await page.addInitScript(() => { localStorage.setItem("tf-wetter", "an"); });
    await page.goto("/");
    const map = page.getByTestId("desktop-map");
    await expect(map.locator("canvas").first()).toBeVisible();
    await shot(page, "desktop-basis");
    // Eine Leiste je Karte (nicht doppelt), rechts in der Karte, links neben der Seitenleiste.
    await expect(page.getByRole("toolbar", { name: "Kartensteuerung" })).toHaveCount(1);
    await checkToolbar(page);
    const bar = (await page.getByRole("toolbar", { name: "Kartensteuerung" }).boundingBox())!;
    const mb = (await map.boundingBox())!;
    expect(bar.x + bar.width).toBeLessThanOrEqual(mb.x + mb.width);
    expect(bar.x + bar.width).toBeGreaterThan(mb.x + mb.width - 24);

    const box = (await map.locator("canvas").first().boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
    await expect(page.getByTestId("map-side")).toBeVisible();
    await checkToolbar(page);
    await expectNoHorizontalOverflow(page, "Karte 1440");
    await shot(page, "desktop-feldblatt");
  });
});
