// Lagebild Stufe 3: Startrampe bauen (Voraussetzung sichtbar), Satellit starten (Karte → Sichtungen), nächster
// Überflug angekündigt, Überflug vorziehen → Streifen live, Bericht „Satellit gestartet“. Unabhängig von der
// Hafenlage: Der erste Streifen liegt immer über dem eigenen Hafen.
import { expect, expectNoHorizontalOverflow, test, until } from "./fixtures.ts";
import { finishBuilds, readState, setBuildings, setResources, updateState } from "./game.ts";

const H = 3600000;

test("Startrampe bauen, Satellit starten, Überflug angekündigt und live", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { kommandozentrale: 8, forschungsamt: 5, radarstation: 5, kraftwerk: 8, lagerkomplex: 10 });
  await setResources(seed.sql, player.baseId, { stahl: 40000, treibstoff: 20000, elektronik: 30000 });

  // Voraussetzung: Radarstation 6 fehlt noch (Gebäude liegen unter Basis → Hafen).
  await page.goto("/?sub=hafen");
  await page.getByRole("button", { name: /^Start\u00AD?rampe 0/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Voraussetzung: Radarstation Stufe 6.")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Startrampe mit Voraussetzung");

  // Sichtungen nennen nur, was fehlt (TST-11) – und mit Radarstation 6 „Voraussetzungen erfüllt“.
  await page.keyboard.press("Escape");
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await page.getByTestId("map-sichtungen").click();
  await expect(page.getByRole("dialog").getByText("Startrampe braucht noch Radarstation 6")).toBeVisible();
  await setBuildings(seed.sql, player.baseId, { radarstation: 6 });
  await page.goto("/?tab=sichtungen");
  await expect(page.getByRole("dialog").getByText("Startrampe bauen (Voraussetzungen erfüllt)")).toBeVisible();

  // Mit Radarstation 6 bauen und fertigstellen.
  await page.goto("/?sub=hafen");
  await page.getByRole("button", { name: /^Start\u00AD?rampe 0/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Bauen/ }).click();
  await expect(page.getByText("Startrampe · Ausbau auf Stufe 1")).toBeVisible();
  await finishBuilds(seed.sql, player.baseId);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Start\u00AD?rampe 1/ })).toBeVisible();

  // Raumfahrt: optischer Satellit erforscht (Forschung selbst prüft der Forschungs-Test).
  await updateState(seed.sql, player.baseId, (s) => { s.research = { ...(s.research ?? {}), levels: { ...(s.research?.levels ?? {}), optischer_satellit: 1 }, order: null }; });
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await page.getByTestId("map-sichtungen").click(); // Sichtungen (früher Meldungen → Lagebild)
  const launch = page.getByTestId("sat-launch");
  await expect(launch).toContainText("Optischer Satellit");
  await expect(launch).toContainText("Radarsatellit");
  await expect(launch).toContainText("Zweig Raumfahrt"); // Radarsatellit noch nicht erforscht: Grund sichtbar
  await expectNoHorizontalOverflow(page, "Lagebild mit Startrampe");
  await launch.getByRole("button", { name: "Starten" }).first().click();
  const next = page.getByTestId("sat-next");
  await expect(next).toContainText(/nächster Überflug in (5|6) h/);
  await expect(next).toContainText("über");
  await expect(next).toContainText("°");
  await expectNoHorizontalOverflow(page, "Lagebild mit Satellit");
  const sat = ((await readState(seed.sql, player.baseId)).satellites as { id: number; launchedAtMs: number }[])[0];
  expect(sat).toBeTruthy();

  // Überflug vorziehen: Start des ersten Überflugs vor 5 s (Zustand und Ereignisse um die Differenz früher).
  const shift = sat.launchedAtMs + 6 * H - Date.now() + 5000;
  await updateState(seed.sql, player.baseId, (s) => {
    for (const x of s.satellites) { x.launchedAtMs -= shift; x.expiresAtMs -= shift; }
  });
  await seed.sql`update game_event set due_at = due_at - ${shift} * interval '1 millisecond'
                 where base_id = ${player.baseId} and type in ('satellite_pass', 'satellite_end') and status = 'pending'`;
  await until(async () => ((await readState(seed.sql, player.baseId)).satellites?.[0]?.passes ?? 0) >= 1, "Überflug verarbeitet");
  await page.reload();
  await page.getByTestId("map-sichtungen").click();
  await expect(page.getByTestId("sat-live")).toContainText("live über");
  await expect(page.getByTestId("satellites")).toContainText("Überflug läuft");
  await expect(page.getByTestId("lagebild-tab").getByText("Optischer Satellit (Streifen)")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Lagebild mit Überflug");

  // Karte: Streifen als Sensor, Seite lädt ohne Fehler.
  await page.keyboard.press("Escape");
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await expect(page.locator("canvas").first()).toBeVisible();

  // Bericht „Satellit gestartet“ mit erstem Überflug.
  await page.getByRole("navigation").getByRole("button", { name: "Meldungen" }).click();
  await page.getByRole("tab", { name: "Berichte" }).click();
  await page.getByText("Optischer Satellit gestartet").first().click();
  await expect(page.getByTestId("sat-report")).toContainText("Erster Überflug");
  await expectNoHorizontalOverflow(page, "Bericht Satellit");
});
