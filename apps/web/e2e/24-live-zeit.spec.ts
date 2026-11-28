// Live-Zeiten: Bestände, Fehlmengen, Wartezeiten und Countdowns laufen ohne Neuöffnen mit (gemeinsame Uhr,
// Hochrechnung aus dem Stand der letzten Abfrage). Die Seite bekommt eine Playwright-Uhr; damit der Server die
// vorgespulte Zeit nicht zurückstellt, bleiben Abrufe (GET) und Live-Verbindung währenddessen angehalten.
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { setBuildings, setResources } from "./game.ts";

/** Abrufe anhalten (nie beantworten) – die Oberfläche rechnet nur mit der Uhr weiter. */
async function holdFetches(page: Page): Promise<() => Promise<void>> {
  const hold = (route: Route) => (route.request().method() === "GET" ? new Promise<void>(() => {}) : route.fallback());
  await page.route("**/trpc/**", hold);
  return () => page.unroute("**/trpc/**", hold);
}

const num = (s: string) => Number(s.replace(/\./g, ""));

test("Gebäudeblatt offen: Bestand steigt, Wartezeit sinkt, Blocker verschwindet, Ausbau wird aktiv; Bau-Countdown läuft", async ({ page, player, seed }) => {
  test.slow();
  await setBuildings(seed.sql, player.baseId, { stahlwerk: 4, kraftwerk: 4, kommandozentrale: 4 });
  await setResources(seed.sql, player.baseId, { stahl: 0, treibstoff: 4000, elektronik: 4000, proviant: 4000 });
  // Live-Meldungen (WebSocket) stumm: ihr Zeitstempel würde die Uhr auf Serverzeit zurückstellen.
  await page.routeWebSocket(/\/ws$/, () => {});
  await page.clock.install({ time: new Date() });

  await page.goto("/?sub=hafen");
  await page.getByRole("button", { name: /^Stahlwerk 4/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Noch nicht genug Ressourcen.")).toBeVisible();
  const up = sheet.getByRole("button", { name: /^Ausbauen auf 5/ });
  await expect(up).toHaveAttribute("aria-disabled", "true");

  const release = await holdFetches(page);
  // Blocker aufklappen: Fortschrittszeile Stahl „Bestand / Bedarf“ und „in ca. …“.
  const hint = sheet.locator("[data-remedy]");
  await hint.getByRole("button", { name: /Noch nicht genug Ressourcen/ }).click();
  const row = hint.getByRole("listitem").filter({ hasText: "Stahl" });
  const read = async () => {
    const t = (await row.textContent()) ?? "";
    const m = /([\d.]+)\s*\/\s*([\d.]+)/.exec(t);
    return { have: num(m![1]), need: num(m![2]), text: t, summary: (await hint.textContent()) ?? "" };
  };
  const a = await read();
  expect(a.text).toMatch(/in ca\. \d/);
  expect(a.summary).toMatch(/Fehlt: [\d.]+ Stahl · ca\. /);
  expect(a.summary).not.toMatch(/\d:\d\d min/); // einheitliches Format, nie „55:59 min“

  // 20 Minuten vorspulen: Bestand steigt, Wartezeit sinkt – ohne Neuöffnen.
  await page.clock.fastForward("00:20:00");
  await expect.poll(async () => (await read()).have).toBeGreaterThan(a.have);
  const b = await read();
  expect(b.need).toBe(a.need);
  expect(b.summary).not.toBe(a.summary);

  // Bis der Stahl reicht: Blocker weg, Knopf aktiv.
  await page.clock.fastForward("24:00:00");
  await expect(sheet.getByText("Noch nicht genug Ressourcen.")).toHaveCount(0);
  await expect(up).not.toHaveAttribute("aria-disabled", "true");

  // Auch der Server hat jetzt genug; Ausbau starten (Abrufe wieder frei), dann läuft der Countdown im Bauhof.
  await setResources(seed.sql, player.baseId, { stahl: 4000 });
  await release();
  await up.click();
  await expect(sheet).toHaveCount(0);
  const yard = page.getByRole("listitem").filter({ hasText: "Stahlwerk · Ausbau auf Stufe 5" });
  const left = yard.getByText(/^noch /);
  await expect(left).toBeVisible();
  await holdFetches(page);
  const before = (await left.textContent()) ?? "";
  expect(before).toMatch(/^noch \d+ (s|min)$|^noch \d+ h/); // einheitlich, nie „1:59 min“
  // Gut eine Minute weiter: aus „noch 2 min“ werden Sekunden (oder der Abschluss) – ohne Neuladen.
  await page.clock.fastForward("00:01:05");
  await expect(yard).not.toContainText(before);
  await expect(yard).toContainText(/noch \d+ (s|min)|wird abgeschlossen/);
});
