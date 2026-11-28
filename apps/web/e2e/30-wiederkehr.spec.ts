// UX-0.43 B8/U-2/C2/C3: „Nächster lohnender Besuch“ mit „Erinnern“ (ohne Push als Kalenderdatei), Post mit
// „Antworten“ und Allianz-Hinweis auf der Lage, Planen vom Ziel (kleinster siegreicher Verband aus dem Bestand bzw.
// was fehlt), Handbuch-Kapitel „Begriffe“, Leerzustände mit Handlung, Erste Schritte bis zum ersten Sieg.
// Mit TF_UXR_SHOTS=1 entstehen Bildschirmfotos unter /tmp/tf-uxr/ (390 und 1440 px).
import { mkdirSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { hexDistanceKm } from "@tidefront/world";
import { register } from "@tidefront/engine";
import { E2E } from "./env.ts";
import { awayFromEdge, expect, expectNoHorizontalOverflow, tapHex, test, uniqueName, type Player, type Seed } from "./fixtures.ts";
import { setBuildings, setUnits, updateState } from "./game.ts";

const HOUR = 3600_000;
const SHOTS = process.env.TF_UXR_SHOTS ? "/tmp/tf-uxr" : null;

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

/** Ausbau läuft: der Bauhof wird in 2 h frei. */
async function buildRunning(seed: Seed, player: Player): Promise<void> {
  const now = Date.now();
  await updateState(seed.sql, player.baseId, (s) => { s.buildQueue = [{ buildingId: "stahlwerk", targetLevel: 2, startedAt: now, finishesAt: now + 2 * HOUR }]; });
}

/** Nächstes sichtbares Nest (Radar) und die Planung von der Karte aus öffnen. */
async function planFromNest(page: Page, seed: Seed, player: Player): Promise<void> {
  const nests = await seed.sql`select id, col, row from nest where defeated_at is null`;
  const nest = nests.map((n) => ({ col: n.col as number, row: n.row as number, d: hexDistanceKm(player, { col: n.col as number, row: n.row as number }) }))
    .filter(awayFromEdge).sort((a, b) => a.d - b.d)[0];
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await tapHex(page, player, nest);
  await expect(page.getByText(/Piratennest Stufe \d/)).toBeVisible();
  await page.getByRole("button", { name: "Mission planen" }).click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
}

test.describe("Handy 390 × 844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Lage: nächster lohnender Besuch → Kalenderdatei, Post mit Antworten, Hinweis ohne Allianz", async ({ page, player, seed }) => {
    await buildRunning(seed, player);
    await setBuildings(seed.sql, player.baseId, { kraftwerk: 1, stahlwerk: 1, raffinerie: 1, versorgungshof: 1, kommandozentrale: 1, kaserne: 1 });
    const otherName = uniqueName("Hdl");
    const other = { id: (await register(seed.engine.db, { inviteCode: E2E.invite, name: otherName, password: "e2e-geheim-123" })).playerId, name: otherName };
    await seed.sql`insert into message (from_player_id, to_player_id, subject, body) values (${other.id}, ${player.id}, 'Handel?', 'Hast du Stahl übrig?')`;
    await page.goto("/");
    const visit = page.getByTestId("lage-visit");
    await expect(visit).toBeVisible();
    await expect(page.getByTestId("lage-visit-reasons")).toContainText("Bauhof frei");
    await expect(page.getByTestId("lage-visit-time")).toHaveText(/^\d\d:\d\d$/);

    // Post von Mitspielern einzeln mit „Antworten“.
    const post = page.locator('[data-lage-row="post"]');
    await expect(post).toContainText(`Post von ${other.name}`);
    await expect(post).toContainText("Handel?");
    // Ohne Allianz: ruhiger Hinweis (ab 5 erledigten Aufträgen).
    await expect(page.locator('[data-lage-row="allianz-hinweis"]')).toContainText("Noch ohne Allianz");
    await expectNoHorizontalOverflow(page, "Lage mit Besuch und Post");
    await shot(page, "m-lage-besuch");
    await visit.scrollIntoViewIfNeeded();
    await shot(page, "m-lage-besuch-2");

    await post.getByTestId("lage-post-reply").click();
    await expect(page.getByRole("dialog")).toContainText(`An ${other.name}`);
    await expect(page.getByRole("textbox", { name: "Betreff" })).toHaveValue("Re: Handel?");
    await page.keyboard.press("Escape");

    // Ohne Push auf diesem Gerät: „Erinnern“ legt eine Kalenderdatei an.
    const remind = page.getByTestId("lage-visit-remind");
    await expect(remind).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent("download"), remind.click()]);
    expect(download.suggestedFilename()).toBe("tidefront-besuch.ics");
    const ics = readFileSync((await download.path())!, "utf8");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(ics).toContain("Bauhof frei");
    await expect(page.getByTestId("lage-visit-note")).toContainText("Kalendertermin");
  });

  test.describe("Planen vom Ziel", () => {
    test.use({ spawnNear: "nest" });

    test("Bestand reicht: kleinster Verband vorgeschlagen; reicht nicht: was fehlt", async ({ page, player, seed }) => {
      await setBuildings(seed.sql, player.baseId, { werft: 3, kaserne: 2, hafenkommandantur: 1, kommandozentrale: 3, radarstation: 8, kraftwerk: 6 });
      await setUnits(seed.sql, player.baseId, { korvette: 8, landungsschiff: 3, schuetzen: 150 });
      await page.goto("/");
      await planFromNest(page, seed, player);
      const s = page.getByTestId("plan-suggest");
      await expect(s).toHaveAttribute("data-status", "bestand", { timeout: 30_000 });
      await expect(s).toContainText("Kleinster siegreicher Verband");
      // Der Vorschlag steht als Verband in der Aktionsleiste – weniger als der ganze Bestand.
      const bar = page.getByText(/^\d+ Einheiten · Feld \d+\/\d+$/);
      await expect(bar).toBeVisible();
      const n = Number((await bar.textContent())!.split(" ")[0]);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(161);
      await expectNoHorizontalOverflow(page, "Planung mit Vorschlag");
      await s.scrollIntoViewIfNeeded();
      await shot(page, "m-plan-vorschlag");

      // Zu wenig daheim: Hinweis, was fehlt, mit „Ausbilden“.
      await setUnits(seed.sql, player.baseId, { schuetzen: 2 });
      await page.goto("/");
      await planFromNest(page, seed, player);
      await expect(s).toHaveAttribute("data-status", "fehlt", { timeout: 30_000 });
      await expect(page.getByTestId("plan-suggest-extra")).toHaveText(/^\+\d+ /);
      await expect(s.getByRole("button", { name: "Ausbilden" })).toBeVisible();
      await s.scrollIntoViewIfNeeded();
      await shot(page, "m-plan-fehlt");
    });
  });

  test("Handbuch: Kapitel „Begriffe“ mit Suche", async ({ page, player }) => {
    void player;
    await page.goto("/");
    await page.getByRole("button", { name: "Menü", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Handbuch/ }).click();
    await page.getByRole("navigation", { name: "Kapitel" }).getByRole("radio", { name: "Begriffe" }).click();
    const g = page.getByTestId("glossary");
    await expect(g).toBeVisible();
    for (const term of ["Lage", "Hafenmeisterei", "Marktwetter", "Umstände", "Gezeit", "Seerat", "Ansehen", "Gesuch", "Tagesbefehl", "Auftrag", "Kommandopunkte"]) {
      await expect(g.locator(`[data-term="${term}"]`)).toBeVisible();
    }
    await expectNoHorizontalOverflow(page, "Handbuch · Begriffe");
    await shot(page, "m-begriffe");
    await g.getByRole("searchbox", { name: "Begriff suchen" }).fill("Marktstimmung");
    await expect(g.locator("[data-term]")).toHaveCount(1);
    await expect(g.locator('[data-term="Marktwetter"]')).toBeVisible();
  });

  test("Leerzustände mit Handlung: Post, Berichte, Allianz", async ({ page, player }) => {
    void player;
    await page.goto("/?tab=post");
    const empty = page.getByTestId("post-empty");
    await expect(empty).toContainText("Noch keine Post");
    await expect(empty.getByRole("button", { name: "Nachricht schreiben" })).toBeVisible();
    await empty.getByRole("button", { name: "Zur Wertung" }).click();
    await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Saison/ })).toHaveAttribute("aria-selected", "true");
    await page.goto("/?tab=allianz");
    await expect(page.getByTestId("alliance-empty")).toContainText("Noch ohne Allianz");
    await shot(page, "m-allianz-leer");
    await page.goto("/?tab=meldungen");
    await page.getByRole("button", { name: "Ersten Einsatz planen" }).click();
    await expect(page.getByRole("tablist", { name: "Truppen" }).getByRole("tab", { name: /^Einsatz/ })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Desktop 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test("Lage mit Besuch, Begriffe am Desktop", async ({ page, player, seed }) => {
    await buildRunning(seed, player);
    await page.goto("/");
    await expect(page.getByTestId("lage-visit")).toBeVisible();
    await expect(page.getByTestId("lage-first-steps")).toContainText("bis zum ersten Sieg");
    await expectNoHorizontalOverflow(page, "Lage Desktop");
    await shot(page, "d-lage-besuch");
    await page.keyboard.press("?");
    await page.getByRole("navigation", { name: "Kapitel" }).getByRole("radio", { name: "Begriffe" }).click();
    await expect(page.getByTestId("glossary")).toBeVisible();
    await shot(page, "d-begriffe");
  });
});
