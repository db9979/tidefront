// Lagebild Stufe 2: Patrouille auf der Karte planen (Wegpunkte antippen) und Sicht erhalten, Radarposten auf einer
// Küste errichten (Meldungen → Lagebild), Aufklärungskampagne mit zwei Zielen.
import type { Page } from "@playwright/test";
import { COLS, hexCenterXY, hexDistanceKm, terrainAt } from "@tidefront/world";
import { awayFromEdge, expect, expectNoHorizontalOverflow, tapHex, test, until } from "./fixtures.ts";
import { foundingSpot, setBuildings, setResources, setUnits } from "./game.ts";

type Hex = { col: number; row: number };
type Sql = Parameters<typeof setUnits>[0];

/** Feld in derselben Zeile in Richtung `sign`, das `ok` erfüllt (abseits des Kartenrands). */
function along(from: Hex, sign: number, minKm: number, maxKm: number, ok: (h: Hex) => boolean): Hex | null {
  for (let dc = 1; dc < COLS; dc++) {
    const h = { col: from.col + sign * dc, row: from.row };
    const d = hexDistanceKm(from, h);
    if (d > maxKm) break;
    if (d >= minKm && awayFromEdge(h) && ok(h)) return h;
  }
  return null;
}

/** Im Planungs-Kärtchen (zentriert auf `center`, Zoom 0,35) auf ein Feld tippen. */
async function tapPlanMap(page: Page, center: Hex, target: Hex) {
  const canvas = page.getByTestId("intel-map").locator("canvas");
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await canvas.boundingBox())!;
  const c = hexCenterXY(center.col, center.row);
  const t = hexCenterXY(target.col, target.row);
  await page.mouse.click(box.x + box.width / 2 + (t.x - c.x) * 0.35, box.y + box.height / 2 + (t.y - c.y) * 0.35);
}

/** Mission zeitlich vorziehen (wie fastForwardMission, ohne auf einen Statuswechsel zu warten). */
async function forward(sql: Sql, missionId: number) {
  const [m] = await sql`select (extract(epoch from arrive_at) * 1000)::float8 as arrive_ms from mission where id = ${missionId}`;
  const delta = Math.round((m.arrive_ms as number) - Date.now() + 200);
  if (delta <= 0) return;
  await sql`update mission set arrive_at = arrive_at - ${delta} * interval '1 millisecond' where id = ${missionId}`;
  await sql`update game_event set due_at = due_at - ${delta} * interval '1 millisecond' where status = 'pending' and type = 'mission_arrive' and (payload->>'missionId')::int = ${missionId}`;
}

async function taken(sql: Sql): Promise<Set<string>> {
  return new Set((await sql`select col, row from nest union all select col, row from base union all select col, row from resource_field`).map((r) => `${r.col},${r.row}`));
}

test("Patrouille: Wegpunkte auf der Karte antippen, auslaufen, Nest am Wegpunkt erkennen", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 3, kommandozentrale: 4, hafenkommandantur: 4 });
  await setUnits(seed.sql, player.baseId, { korvette: 3 });
  await setResources(seed.sql, player.baseId, { treibstoff: 5000 });
  const busy = await taken(seed.sql);
  const sea = (h: Hex) => terrainAt(h.col, h.row) === "sea" && !busy.has(`${h.col},${h.row}`);
  // Umgebung absuchen: erster Wegpunkt 250–420 km vom Hafen auf See (mit Nest), zweiter 150–260 km weiter.
  const near = (c: Hex, r: number) => { const out: Hex[] = []; for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) { const h = { col: c.col + dc, row: c.row + dr }; if (awayFromEdge(h)) out.push(h); } return out; };
  let wp1: Hex | null = null, wp2: Hex | null = null, nest: Hex | null = null;
  for (const a of near(player, 6).filter((h) => sea(h) && hexDistanceKm(player, h) >= 250 && hexDistanceKm(player, h) <= 420)) {
    const ring = near(a, 3);
    const b = ring.find((h) => sea(h) && hexDistanceKm(a, h) >= 150 && hexDistanceKm(a, h) <= 260 && hexDistanceKm(player, h) > 200);
    // Nest direkt am ersten Wegpunkt (außerhalb von Ausguck und Radar des Hafens): dort beginnt die Runde.
    if (b) { wp1 = a; wp2 = b; nest = a; break; }
  }
  test.skip(!wp1 || !wp2 || !nest, "keine offene See neben diesem Hafen");
  const [n] = await seed.sql`insert into nest (col, row, level) values (${nest!.col}, ${nest!.row}, 3) returning id`;
  try {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
    await tapHex(page, player, wp1!);
    await page.getByRole("button", { name: "Patrouille ab hier" }).click();
    await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^1 · / })).toBeVisible();
    await tapPlanMap(page, wp1!, wp2!);
    await expect(page.getByRole("button", { name: /^2 · / })).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: /^Korvette\d/ }).getByRole("button", { name: "alle" }).click();
    await expect(page.getByTestId("intel-preview")).toContainText("Sicht 105 km");
    await expectNoHorizontalOverflow(page, "Patrouille planen");
    await page.getByRole("button", { name: "Auslaufen" }).click();
    await expect(page.getByText("Mission gestartet")).toBeVisible();
    const [m] = await seed.sql`select id from mission where player_id = ${player.id} and type = 'patrouille'`;
    await forward(seed.sql, m.id as number);
    await until(async () => (await seed.sql`select status from mission where id = ${m.id}`)[0].status === "holding", "Patrouille auf Station");
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
    // Das Schiff liegt auf dem Nest (Antippen öffnete den Verband): Die Karte speichert die Sichtung, das Lagebild zeigt sie.
    await page.waitForTimeout(800);
    await page.getByRole("navigation").getByRole("button", { name: "Meldungen" }).click();
    await page.getByRole("tab", { name: "Lagebild" }).click();
    const seen = page.getByTestId("lagebild-tab").getByRole("listitem").filter({ hasText: "Piratennest Stufe 3" });
    await expect(seen).toBeVisible();
    await expect(seen).toContainText("Patrouille aus");
    await expectNoHorizontalOverflow(page, "Lagebild mit Sichtung");
  } finally {
    await seed.sql`delete from intel_sighting where kind = 'nest' and object_id = ${n.id}`;
    await seed.sql`delete from nest where id = ${n.id}`;
  }
});

test.describe("mit freiem Gründungsfeld", () => {
  test.use({ spawnNear: "founding" });

test("Radarposten: auf freier Küste errichten, im Lagebild verwalten", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { radarstation: 3, werft: 3, kaserne: 3, kommandozentrale: 4, hafenkommandantur: 4 });
  await setUnits(seed.sql, player.baseId, { pioniere: 6, landungsschiff: 1 });
  await setResources(seed.sql, player.baseId, { stahl: 5000, elektronik: 5000, treibstoff: 5000 });
  const site = await foundingSpot(seed.sql, player);
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await tapHex(page, player, site);
  await page.getByRole("button", { name: "Radarposten errichten" }).click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
  await expect(page.getByTestId("intel-preview")).toContainText("Baukosten");
  await expectNoHorizontalOverflow(page, "Radarposten planen");
  await page.getByRole("button", { name: "Errichten" }).click();
  await expect(page.getByText("Mission gestartet")).toBeVisible();
  const [m] = await seed.sql`select id from mission where player_id = ${player.id} and type = 'radarposten'`;
  await forward(seed.sql, m.id as number);
  await until(async () => (await seed.sql`select id from radar_post where player_id = ${player.id}`)[0], "Radarposten steht");
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Meldungen" }).click();
  await page.getByRole("tab", { name: "Lagebild" }).click();
  const row = page.getByTestId("lagebild-tab").locator("[data-post]");
  await expect(row).toContainText(`Feld ${site.col}/${site.row}`);
  await expect(row).toContainText("in Betrieb");
  await expect(page.getByTestId("lagebild-tab").getByRole("listitem").filter({ hasText: "Radarposten" }).filter({ hasText: "bis 250 km" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Meldungen → Lagebild");
});
});

test("Aufklärungskampagne: zwei Nester nacheinander, je ein Lagebild", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 3, kommandozentrale: 4, hafenkommandantur: 4 });
  await setUnits(seed.sql, player.baseId, { korvette: 2 });
  await setResources(seed.sql, player.baseId, { treibstoff: 5000 });
  const busy = await taken(seed.sql);
  const free = (h: Hex) => !busy.has(`${h.col},${h.row}`);
  let a: Hex | null = null, b: Hex | null = null;
  for (const sign of [1, -1]) {
    a = along(player, sign, 200, 350, free);
    b = a && along(a, sign, 150, 260, free);
    if (a && b) break;
  }
  test.skip(!a || !b, "keine freien Felder neben diesem Hafen");
  const ids: number[] = [];
  for (const h of [a!, b!]) ids.push((await seed.sql`insert into nest (col, row, level) values (${h.col}, ${h.row}, 2) returning id`)[0].id as number);
  try {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
    await tapHex(page, player, a!);
    await page.getByRole("button", { name: "Mission planen" }).click();
    await page.getByRole("button", { name: "Kampagne", exact: true }).click();
    await expect(page.getByRole("button", { name: /^1 · Piratennest/ })).toBeVisible();
    await tapPlanMap(page, a!, b!);
    await expect(page.getByRole("button", { name: /^2 · Piratennest/ })).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: /^Korvette\d/ }).getByRole("button", { name: "mehr" }).click();
    await expect(page.getByTestId("intel-preview")).toBeVisible();
    await expectNoHorizontalOverflow(page, "Kampagne planen");
    await page.getByRole("button", { name: "Auslaufen" }).click();
    await expect(page.getByText("Mission gestartet")).toBeVisible();
    const [m] = await seed.sql`select id from mission where player_id = ${player.id} and type = 'aufklaerung'`;
    for (const nestId of ids) {
      await forward(seed.sql, m.id as number);
      await until(async () => (await seed.sql`select id from battle_report where attacker_player_id = ${player.id} and kind = 'aufklaerung' and nest_id = ${nestId}`)[0], `Lagebild Nest ${nestId}`);
    }
    await page.getByRole("navigation").getByRole("button", { name: "Meldungen" }).click();
    await expect(page.getByText(/^Aufklärung: Piratennest Stufe 2/)).toHaveCount(2);
  } finally {
    await seed.sql`delete from intel_sighting where kind = 'nest' and object_id in ${seed.sql(ids)}`;
    await seed.sql`delete from nest where id in ${seed.sql(ids)}`;
  }
});
