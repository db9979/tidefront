// Börse v1.30: Saisonchart (Stundenschlusskurse, Zeitraum 7 Tage / Saison) und gleitendes Tageslimit mit „frei ab“.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";
import { setBuildings, setResources } from "./game.ts";

const HOUR = 3_600_000;

test("Börse: Saisonchart mit Richtwert-Linien", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 3 });
  // Drei Tage Stundenschlusskurse für Stahl: erst über, dann unter dem Richtwert; effektiver Richtwert zeitweise +5 %.
  const end = Math.floor(Date.now() / HOUR) * HOUR;
  const rows = Array.from({ length: 72 }, (_, i) => {
    const t = end - (71 - i) * HOUR;
    return { resource: "stahl", hour_ms: t, price: 1 + 0.2 * Math.sin(i / 8), ref: i > 30 && i < 50 ? 1.05 : 1 };
  });
  await seed.sql`delete from market_price_hour where resource = 'stahl'`;
  await seed.sql`insert into market_price_hour ${seed.sql(rows)} on conflict do nothing`;

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
  await page.getByRole("tab", { name: "Handel" }).click();
  await page.getByRole("button", { name: /^Kursverlauf Stahl/ }).click();
  const range = page.getByRole("radiogroup", { name: "Zeitraum" });
  await expect(range.getByRole("radio", { name: "24 Stunden" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("img", { name: /Kursdiagramm Stahl/ })).toBeVisible();

  await range.getByRole("radio", { name: "Saison" }).click();
  const chart = page.getByRole("img", { name: /Saisonchart Stahl/ });
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAccessibleName(/ganze Saison: .*Grundrichtwert 1,00\. \d+ Stundenschlusskurse\./);
  // Legende (für Vorleser verborgen, das Diagramm beschreibt sich selbst)
  await expect(page.locator("li", { hasText: "Grundrichtwert" })).toBeVisible();
  await expect(page.locator("li", { hasText: "Richtwert mit Nachrichten" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Börse · Saisonchart");

  await range.getByRole("radio", { name: "7 Tage" }).click();
  await expect(page.getByRole("img", { name: /Saisonchart Stahl.*letzte 7 Tage/ })).toBeVisible();

  // Ressource ohne Verlauf: Hinweis statt leerem Diagramm.
  await page.getByRole("radio", { name: /^Proviant:/ }).click();
  await range.getByRole("radio", { name: "Saison" }).click();
  await expect(page.getByText(/Noch zu wenig Verlauf/)).toBeVisible();
});

test("Börse: Tageslimit gleitend – „wieder frei ab“ statt Mitternacht", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 3 });
  await setResources(seed.sql, player.baseId, { stahl: 4000 });
  // Limit für Stahl in dieser Stunde ausgeschöpft (Fach der laufenden Stunde), Treibstoff vor drei Stunden zur Hälfte.
  const h = Math.floor(Date.now() / HOUR);
  const tradeHours = [{ h: h - 3, q: { treibstoff: 100 } }, { h, q: { stahl: 1_000_000 } }];
  await seed.sql`update player set trader = jsonb_set(trader - 'dailyVolume' - 'dailyDayIndex', '{tradeHours}', ${JSON.stringify(tradeHours)}::jsonb) where id = ${player.id}`;
  const free = new Date((h + 24) * HOUR).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Börse" }).click();
  await page.getByRole("tab", { name: "Handel" }).click();
  await expect(page.getByRole("heading", { name: "Order Stahl" })).toBeVisible();
  await expect(page.getByText(`Tageslimit für Stahl erreicht – 1.000.000 wieder frei ab morgen ${free} Uhr.`)).toBeVisible();
  await expect(page.getByText(`Gleitend: 1.000.000 wieder frei ab morgen ${free} Uhr.`)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Börse · Tageslimit gleitend");

  // Treibstoff: Rest frei, zu große Menge nennt den Zeitpunkt, ab dem sie passt.
  await page.getByRole("radio", { name: /^Treibstoff:/ }).click();
  await expect(page.getByText(/Gleitend: 100 wieder frei ab (morgen )?\d{2}:00 Uhr\./)).toBeVisible();
});
