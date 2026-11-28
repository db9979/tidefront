// UX 0.43 (Paket A10): Lage neu geordnet und gegen Rückfall gesichert – bei 390 × 844 ist „Alle abholen“ ohne Scrollen
// sichtbar, die Reihenfolge stimmt (Wartet auf dich → Nächster Schritt → Unterwegs → Als Nächstes), jede Mission/jeder
// Konvoi steht nur einmal, die Bauempfehlung baut mit einem Tipp; Fortschrittszeile → Saison; Rückkehrkarte „Seit
// deinem letzten Besuch“ (ereignisgesteuert, Schließen quittiert auf dem Server); Meldungen mit vier kurzen Reitern
// (Berichte · Post · Allianz · Saison) samt Ungelesen-Zahl; Bauknopf im Gebäudeblatt im Viewport; Push-Frage einmalig.
// Mit TF_UXL_SHOTS=1 entstehen Bildschirmfotos unter /tmp/tf-uxl/ (390 und 1440 px).
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { nearestTradePortBySea } from "@tidefront/world";
import { E2E } from "./env.ts";
import { expect, expectNoHorizontalOverflow, openHafen, test } from "./fixtures.ts";
import { readState, setBuildings, setResources, setUnits } from "./game.ts";

const HOUR = 3600_000;
const DONE_1_TO_5 = { kraftwerk: 1, stahlwerk: 1, raffinerie: 1, versorgungshof: 1, kommandozentrale: 1, kaserne: 1 };
const SHOTS = process.env.TF_UXL_SHOTS ? "/tmp/tf-uxl" : null;

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

const top = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!.y;

test.describe("Handy 390 × 844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Lage: Reihenfolge, Abholen ohne Scrollen, Bauempfehlung, jede Fahrt einmal, Fortschritt → Saison", async ({ page, player, seed }) => {
    await setBuildings(seed.sql, player.baseId, { ...DONE_1_TO_5, lagerkomplex: 12 });
    await setResources(seed.sql, player.baseId, { stahl: 5000, treibstoff: 3000, elektronik: 1500, proviant: 3000 });
    const now = Date.now();
    const port = nearestTradePortBySea(player);
    const [cv] = await seed.sql`insert into convoy (kind, sender_id, recipient_id, recipient_base_id, from_col, from_row, to_col, to_row, cargo, depart_at, arrive_at)
      values ('boerse', null, ${player.id}, ${player.baseId}, ${port.col}, ${port.row}, ${player.col}, ${player.row}, ${JSON.stringify({ stahl: 100 })}::jsonb,
        ${new Date(now - HOUR).toISOString()}, ${new Date(now + 3 * HOUR).toISOString()}) returning id`;
    await page.goto("/");
    await expect(page.getByTestId("lage-tab")).toBeVisible();

    // Fortschritt oben: Platz, Saisontag.
    await expect(page.getByTestId("lage-progress")).toContainText(/Platz \d+ von \d+/);
    await expect(page.getByTestId("lage-progress")).toContainText(/Tag \d+\/\d+/);

    // „Alle abholen“ steht in der Kopfzeile von „Wartet auf dich“ und ist ohne Scrollen ganz sichtbar.
    const claim = page.getByTestId("lage-waiting").getByRole("button", { name: /^Alle abholen \(\d+\)$/ });
    await expect(claim).toBeInViewport({ ratio: 1 });
    // Nächster Schritt mit sichtbarer Bauempfehlung (zwei bewusste Taps, kein Kombi-Knopf).
    const next = page.getByTestId("lage-next");
    await expect(next).toContainText("Bauhof frei");
    await expect(next.getByTestId("advice-build")).toBeVisible();
    // Reihenfolge: Wartet auf dich → Nächster Schritt → Unterwegs.
    expect(await top(page, "lage-waiting")).toBeLessThan(await top(page, "lage-next"));
    expect(await top(page, "lage-next")).toBeLessThan(await top(page, "lage-underway"));
    // Der Konvoi steht nur unter „Unterwegs“, nicht zusätzlich unter „Als Nächstes“.
    await expect(page.getByTestId("lage-underway").locator(`[data-lage-key="konvoi-weg:${cv.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-lage-key="konvoi:${cv.id}"]`)).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "Lage 390");
    await shot(page, "m-lage-1");
    await shot(page, "m-lage-ganz", true);

    // Abholen mit Summe („+…“), dann Bauen mit einem Tipp.
    await claim.click();
    await expect(page.getByTestId("claim-all-note")).toContainText(/abgeholt: \+\d/);
    await shot(page, "m-lage-abgeholt");
    const label = (await next.locator("strong").first().textContent()) ?? "";
    await next.getByTestId("advice-build").click();
    await expect(page.getByTestId("lage-next")).toHaveCount(0);
    const q = (await readState(seed.sql, player.baseId)).buildQueue as { buildingId: string; targetLevel: number }[];
    expect(q).toHaveLength(1);
    expect(label).toContain(String(q[0].targetLevel));
    await expect(page.getByTestId("lage-soon").locator(`[data-lage-key^="bau:${player.baseId}:${q[0].buildingId}"]`)).toBeVisible();

    // Fortschrittszeile → Meldungen → Saison.
    await page.getByTestId("lage-progress").click();
    await expect(page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Saison/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("season-day")).toContainText(/Tag \d+\/\d+/);
    await seed.sql`delete from convoy where id = ${cv.id}`;
  });

  test("Rückkehrkarte: seit dem letzten Besuch – Nachricht, Bau, Rang; Schließen quittiert", async ({ page, player, seed }) => {
    await setBuildings(seed.sql, player.baseId, { ...DONE_1_TO_5, lagerkomplex: 15 });
    const now = Date.now();
    await seed.sql`update player set lage_ack_at = ${new Date(now - 8 * HOUR).toISOString()}, lage_ack_rank = 99, created_at = ${new Date(now - 30 * 24 * HOUR).toISOString()} where id = ${player.id}`;
    await seed.sql`insert into message (from_player_id, to_player_id, subject, body, created_at) values (null, ${player.id}, 'Lieferung bereit', 'Text', ${new Date(now - HOUR).toISOString()})`;
    await seed.sql`insert into summary_entry (player_id, kind, title, body, created_at) values (${player.id}, 'build', 'Ausbau fertig', 'Stahlwerk ist jetzt auf Stufe 2.', ${new Date(now - 2 * HOUR).toISOString()})`;
    await page.goto("/");
    const card = page.getByTestId("lage-return");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("lage-return-range")).toContainText(/^seit .+ Uhr · 8 h/);
    await expect(card.locator('[data-return="post"]')).toContainText(/neue Nachrichten? · Hafenmeisterei: /);
    await expect(card.locator('[data-return="bau"]')).toContainText("Stahlwerk ist jetzt auf Stufe 2");
    // Rang nur, wenn der (zwischengespeicherte) Stand den neuen Spieler schon kennt; dann „Platz 99 → n“.
    if (await card.locator('[data-return="rang"]').count()) await expect(card.locator('[data-return="rang"]')).toContainText(/Platz 99 → \d+/);
    // Rückkehrkarte vor „Wartet auf dich“, „Alle abholen“ bleibt trotzdem ohne Scrollen sichtbar.
    expect(await top(page, "lage-return")).toBeLessThan(await top(page, "lage-waiting"));
    await expect(page.getByTestId("lage-waiting").getByRole("button", { name: /^Alle abholen/ })).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page, "Lage · Rückkehrkarte");
    await shot(page, "m-lage-rueckkehr");
    await card.getByRole("button", { name: "Rückblick schließen" }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(async () => Number((await seed.sql`select extract(epoch from lage_ack_at) * 1000 as ms from player where id = ${player.id}`)[0].ms)).toBeGreaterThan(now - 60_000);
    await page.reload();
    await expect(page.getByTestId("lage-waiting")).toBeVisible();
    await expect(page.getByTestId("lage-return")).toHaveCount(0);
  });

  test("Meldungen: Berichte · Post · Allianz · Saison passen mit Ungelesen-Zahl, Saison mit Welt", async ({ page, player, seed }) => {
    await seed.sql`insert into message (from_player_id, to_player_id, subject, body) values (null, ${player.id}, 'Hallo', 'Text')`;
    await page.goto("/?tab=berichte");
    const tabs = page.getByRole("tablist", { name: "Meldungen" });
    await expect(tabs.getByRole("tab")).toHaveCount(4);
    for (const name of ["Berichte", "Post", "Allianz", "Saison"]) await expect(tabs.getByRole("tab", { name: new RegExp(`^${name}`) })).toBeInViewport({ ratio: 1 });
    await expect(tabs.getByRole("tab", { name: /^Post/ })).toContainText("1");
    await tabs.getByRole("tab", { name: /^Post/ }).click();
    await expect(page.getByText("Hafenmeisterei").first()).toBeVisible(); // Absender der Systemnachrichten (E-5)
    await tabs.getByRole("tab", { name: /^Saison/ }).click();
    const inner = page.getByRole("tablist", { name: "Saison" });
    for (const name of ["Bilanz", "Erfolge", "Welt", "Wertung"]) {
      await inner.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
      await expect(inner.getByRole("tab", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-selected", "true");
      if (name === "Welt") await expect(page.getByTestId("politik-panel").or(page.getByTestId("politik-off"))).toBeVisible();
      await expectNoHorizontalOverflow(page, `Meldungen · Saison · ${name}`);
    }
    await shot(page, "m-meldungen-saison");
    // Adresse ?sub=post öffnet den Reiter „Post“.
    await page.goto("/?tab=berichte&sub=post");
    await expect(tabs.getByRole("tab", { name: /^Post/ })).toHaveAttribute("aria-selected", "true");
  });

  test("Gebäudeblatt: Bauknopf mit Dauer im Viewport; Hafen mit „Empfohlen“; Push-Frage einmalig", async ({ page, context, player, seed }) => {
    // Kopfloses Chromium meldet Benachrichtigungen immer als „denied“ (dann fragt die App zu Recht nie): hier wie ein
    // frischer Browser („default“) behandeln.
    await context.grantPermissions(["notifications"], { origin: E2E.webUrl });
    await page.addInitScript(() => { if ("Notification" in window) Object.defineProperty(Notification, "permission", { get: () => "default" }); });
    await setResources(seed.sql, player.baseId, { stahl: 5000, treibstoff: 3000, elektronik: 1500, proviant: 3000 });
    await page.goto("/?sub=hafen");
    await page.evaluate(() => localStorage.removeItem("tf-push-asked")); // die Fixture markiert die Frage als gestellt
    await expect(page.getByTestId("harbor-advice")).toBeVisible();
    await shot(page, "m-hafen");
    await page.getByRole("button", { name: /^Kraftwerk 0/ }).click();
    const sheet = page.getByRole("dialog");
    const build = sheet.getByRole("button", { name: /^Bauen · / });
    await expect(build).toBeInViewport({ ratio: 1 });
    await shot(page, "m-gebaeudeblatt");
    await build.click();
    // Erster Bau: einmalige Frage, ob Push gewünscht ist.
    const ask = page.getByTestId("push-ask");
    {
      await expect(ask).toContainText("Soll ich dir Bescheid sagen, wenn der Bau fertig ist?");
      await shot(page, "m-push-frage");
      // Die Tests laufen mit iPhone-Kennung im Browser (nicht als Home-Bildschirm-App): Hinweis, wie es auf iOS geht.
      await expect(ask).toContainText("Zum Home-Bildschirm");
      await page.getByRole("button", { name: "Verstanden" }).click();
      await expect(ask).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("tf-push-asked"))).toBe("ios");
    }
    // Ausgebautes Gebäude mit viel Inhalt: Knopf trotzdem ohne Scrollen sichtbar.
    await setBuildings(seed.sql, player.baseId, { stahlwerk: 6, kommandozentrale: 6 });
    await page.reload();
    await page.getByRole("button", { name: /^Stahlwerk 6/ }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: /^(Einreihen: Stufe 7|Ausbauen auf 7)/ })).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    // Danach nie wieder gefragt.
    await page.getByRole("button", { name: /^Stahlwerk 6/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(Einreihen: Stufe 7|Ausbauen auf 7)/ }).click();
    await expect(page.getByTestId("push-ask")).toHaveCount(0);
    void openHafen;
  });

  test("Neuling: „Erste Schritte“ oben, keine Bauempfehlung, keine ruhige Weltpolitik; ohne Einheiten erst ausbilden", async ({ page, player, seed }) => {
    void seed; void player;
    await page.goto("/");
    const first = page.getByTestId("lage-first-steps");
    await expect(first).toContainText("Kraftwerk bauen");
    await expect(first).toContainText("0/11");
    await expect(page.getByTestId("lage-next")).toHaveCount(0);
    await expect(page.getByTestId("politik-line")).toHaveCount(0);
    await expect(first.getByRole("button", { name: "Los" })).toBeInViewport({ ratio: 1 });
    await shot(page, "m-neuling-lage");
    await first.getByRole("button", { name: "Los" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: /^Bauen · / })).toBeVisible();
    await page.keyboard.press("Escape");
    await setUnits(seed.sql, player.baseId, {});
    await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
    await page.getByRole("tablist", { name: "Truppen" }).getByRole("tab", { name: /^Einsatz/ }).click();
    await expect(page.getByRole("button", { name: "Erste Einheiten ausbilden" })).toBeVisible();
  });
});

test.describe("Desktop 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test("Lage und Meldungen am Desktop", async ({ page, player, seed }) => {
    await setBuildings(seed.sql, player.baseId, DONE_1_TO_5);
    await page.goto("/");
    await expect(page.getByTestId("lage-progress")).toBeVisible();
    await expect(page.getByTestId("lage-waiting").getByRole("button", { name: /^Alle abholen/ })).toBeInViewport({ ratio: 1 });
    await shot(page, "d-lage");
    await page.goto("/?tab=karte");
    await page.getByTestId("map-ebenen").click();
    await expect(page.getByRole("dialog").getByTestId("map-legend")).toBeVisible();
    await shot(page, "d-karte-ebenen");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/?tab=berichte&sub=saison");
    await expect(page.getByRole("tablist", { name: "Saison" })).toBeVisible();
    await shot(page, "d-saison");
  });
});
