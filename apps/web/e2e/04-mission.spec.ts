// Mission gegen ein Piratennest: Ziel auf der Karte antippen, planen, auslaufen, vorspulen, Kampfbericht lesen.
import { hexDistanceKm } from "@tidefront/world";
import { awayFromEdge, expect, expectNoHorizontalOverflow, tapHex, test, until } from "./fixtures.ts";
import { fastForwardMission, setBuildings, setUnits } from "./game.ts";

test.use({ spawnNear: "nest" });

test("Überfall auf ein Nest planen, starten und auswerten", async ({ page, player, seed }) => {
  // Radar: das Nest liegt sicher in Sicht (Lagebild).
  await setBuildings(seed.sql, player.baseId, { werft: 3, kaserne: 2, hafenkommandantur: 1, kommandozentrale: 3, radarstation: 8, kraftwerk: 6 });
  await setUnits(seed.sql, player.baseId, { korvette: 6, landungsschiff: 2, schuetzen: 30 });
  const nests = await seed.sql`select id, col, row, level from nest where defeated_at is null`;
  const nest = nests
    .map((n) => ({ id: n.id as number, col: n.col as number, row: n.row as number, d: hexDistanceKm(player, { col: n.col as number, row: n.row as number }) }))
    .filter(awayFromEdge)
    .sort((a, b) => a.d - b.d)[0];

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await expectNoHorizontalOverflow(page, "Karte");
  await tapHex(page, player, nest);
  await expect(page.getByText(/Piratennest Stufe \d/)).toBeVisible();
  await expect(page.getByText(/^Besatzung:/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Karte mit Nest-Info");
  await page.getByRole("button", { name: "Mission planen" }).click();

  // Planung
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
  await expect(page.getByText(/Piratennest Stufe/)).toBeVisible();
  const unitRow = (name: string) => page.getByRole("listitem").filter({ hasText: new RegExp(`^${name}\\d`) });
  await unitRow("Korvette").getByRole("button", { name: "alle" }).click();
  await unitRow("Landungsschiff").getByRole("button", { name: "alle" }).click();
  await unitRow("Schützen").getByRole("button", { name: "alle" }).click();
  await expect(page.getByText(/^Fahrt .* Treibstoff$/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Missionsplanung");
  await page.getByRole("button", { name: "Auslaufen" }).click();
  await expect(page.getByRole("heading", { name: "Mission gestartet" })).toBeVisible();
  await page.getByRole("button", { name: "Fertig" }).click();

  const [m] = await seed.sql`select id from mission where player_id = ${player.id} order by id desc limit 1`;
  expect(m).toBeTruthy();

  // Truppen zeigen die laufende Mission.
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: "Einsatz" }).click();
  await expect(page.getByRole("heading", { name: "Unterwegs 1/1" })).toBeVisible();
  await expect(page.locator("li[data-mission]").getByText("Hinfahrt")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Truppen mit Mission");

  // Ankunft und Rückkehr vorspulen.
  expect(await fastForwardMission(seed.sql, m.id)).toMatch(/returning|done/);
  await fastForwardMission(seed.sql, m.id);
  await until(async () => (await seed.sql`select status from mission where id = ${m.id}`)[0].status === "done", "Mission heimgekehrt");

  // Kampfbericht in den Meldungen öffnen.
  await page.reload();
  const nav = page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ });
  await expect(nav).toHaveAccessibleName(/Meldungen\s*\d+/);
  await nav.click();
  const report = page.getByRole("button", { name: /Nest|Piraten/ }).first();
  await expect(report).toBeVisible();
  await expectNoHorizontalOverflow(page, "Meldungen · Berichte");
  await report.click();
  await expect(page.getByText(/Sieg|Niederlage|gewonnen|verloren/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "Kampfbericht");
});
