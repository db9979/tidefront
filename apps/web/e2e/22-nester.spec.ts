// Lebendige Nester und Aufklärung auf Sicht: Kartenblatt eines erkannten Nests mit Spannen („Anlagen unbekannt“,
// Beute 100–130 %), Aufklärung mit Drohne kehrt am Wendepunkt (200 km) um und liefert das genaue Lagebild (Alter,
// hochgerechnet), „Lohnende Ziele“ zeigt Werte und „Netto“ – alles ohne waagrechten Überlauf bei 390 px.
import type { Page } from "@playwright/test";
import { COLS, hexCenter, hexDistanceKm } from "@tidefront/world";
import { weatherAt } from "@tidefront/game-core";
import { balance } from "@tidefront/engine";
import { awayFromEdge, expect, expectNoHorizontalOverflow, tapHex, test, until } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

type Hex = { col: number; row: number };
type Sql = Parameters<typeof setUnits>[0];

test.use({ viewport: { width: 390, height: 860 } });

async function taken(sql: Sql): Promise<Set<string>> {
  return new Set((await sql`select col, row from nest union all select col, row from base union all select col, row from resource_field`).map((r) => `${r.col},${r.row}`));
}

/** Freies Feld in `minKm`–`maxKm` vom Hafen (Ring um den Hafen, nah zuerst). */
function freeAround(from: Hex, minKm: number, maxKm: number, busy: Set<string>): Hex | null {
  const out: { h: Hex; d: number }[] = [];
  for (let dr = -8; dr <= 8; dr++) for (let dc = -8; dc <= 8; dc++) {
    const h = { col: from.col + dc, row: from.row + dr };
    if (h.col < 0 || h.col >= COLS || !awayFromEdge(h) || busy.has(`${h.col},${h.row}`)) continue;
    const d = hexDistanceKm(from, h);
    if (d >= minKm && d <= maxKm) out.push({ h, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out[0]?.h ?? null;
}

async function forward(sql: Sql, missionId: number) {
  const [m] = await sql`select (extract(epoch from arrive_at) * 1000)::float8 as arrive_ms from mission where id = ${missionId}`;
  const delta = Math.round((m.arrive_ms as number) - Date.now() + 200);
  if (delta <= 0) return;
  await sql`update mission set arrive_at = arrive_at - ${delta} * interval '1 millisecond' where id = ${missionId}`;
  await sql`update game_event set due_at = due_at - ${delta} * interval '1 millisecond' where status = 'pending' and type = 'mission_arrive' and (payload->>'missionId')::int = ${missionId}`;
}

async function openMapAt(page: Page, home: Hex, target: Hex) {
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await tapHex(page, home, target);
}

test("Kartenblatt: erkanntes Nest zeigt Spannen, „Anlagen unbekannt“ und Beute 100–130 %", async ({ page, player, seed }) => {
  const spot = freeAround(player, 60, 110, await taken(seed.sql));
  test.skip(!spot, "kein freies Feld im Ausguck");
  const [n] = await seed.sql`insert into nest (col, row, level) values (${spot!.col}, ${spot!.row}, 4) returning id`;
  try {
    await openMapAt(page, player, spot!);
    await expect(page.getByText(/Piratennest Stufe 4/)).toBeVisible();
    const intel = page.getByTestId("nest-intel");
    await expect(intel).toBeVisible();
    await expect(intel).toContainText(/18–26\s*Schnellboote/);
    await expect(intel).toContainText(/172–258\s*Milizionäre|172–258/);
    await expect(page.getByTestId("anlagen-unbekannt")).toBeVisible();
    await expect(page.getByTestId("nest-beute")).toContainText("100 %–130 %");
    await expectNoHorizontalOverflow(page, "Nest-Blatt mit Spanne");
  } finally {
    await seed.sql`delete from intel_sighting where kind = 'nest' and object_id = ${n.id}`;
    await seed.sql`delete from nest where id = ${n.id}`;
  }
});

test("Aufklärung auf Sicht: Drohne kehrt 200 km vor dem Ziel um, Lagebild genau, „Lohnende Ziele“ mit Werten", async ({ page, player, seed }) => {
  test.slow();
  await setBuildings(seed.sql, player.baseId, { werft: 3, flugfeld: 3, kommandozentrale: 4, hafenkommandantur: 4, kaserne: 2 });
  await setUnits(seed.sql, player.baseId, { aufklaerungsdrohne: 2, korvette: 6, landungsschiff: 2, schuetzen: 40 });
  await setResources(seed.sql, player.baseId, { treibstoff: 5000 });
  const spot = freeAround(player, 330, 430, await taken(seed.sql));
  test.skip(!spot, "kein freies Feld in 330–430 km");
  // Echtes Wetter: Bei Sturm am Hafen starten reine Luftmissionen nicht (Regel, kein Fehler) – dann nichts zu prüfen.
  test.skip(weatherAt(hexCenter(player.col, player.row), Date.now(), balance.weather!).storm, "Sturm am Heimathafen: Drohnen starten nicht");
  const [n] = await seed.sql`insert into nest (col, row, level) values (${spot!.col}, ${spot!.row}, 3) returning id`;
  try {
    await openMapAt(page, player, spot!);
    await page.getByRole("button", { name: "Mission planen" }).click();
    await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
    const art = page.getByRole("button", { name: "Aufklärung", exact: true });
    if (await art.isVisible()) await art.click();
    else { await page.getByRole("button", { name: "Ändern" }).first().click(); await page.getByRole("button", { name: "Aufklärung", exact: true }).click(); }
    await page.getByRole("listitem").filter({ hasText: /^Aufklärungsdrohne\d/ }).getByRole("button", { name: "mehr" }).click();
    await expect(page.locator("[data-sight-turn='200']")).toBeVisible({ timeout: 15000 });
    await expectNoHorizontalOverflow(page, "Aufklärung auf Sicht planen");
    await page.getByRole("button", { name: /^(Starten|Auslaufen|Losschicken)$/ }).click();
    await expect(page.getByText("Mission gestartet")).toBeVisible();
    const [m] = await seed.sql`select id, plan from mission where player_id = ${player.id} and type = 'aufklaerung' order by id desc limit 1`;
    expect((m.plan as { sightTurn?: { rangeKm: number } }).sightTurn?.rangeKm).toBe(200);
    await forward(seed.sql, m.id as number);
    await until(async () => (await seed.sql`select id from battle_report where attacker_player_id = ${player.id} and kind = 'aufklaerung' and nest_id = ${n.id}`)[0], "Lagebild");
    // Kartenblatt: genau, mit Alter des Lagebilds.
    await openMapAt(page, player, spot!);
    await expect(page.getByTestId("nest-intel")).toHaveAttribute("data-exact", "1");
    await expect(page.getByTestId("lagebild-alter")).toContainText("Lagebild");
    await expectNoHorizontalOverflow(page, "Nest-Blatt mit Lagebild");
    // Lohnende Ziele: Werte mit Lagebild-Alter und Netto.
    await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
    await page.getByRole("tab", { name: /^Einsatz/ }).click();
    const row = page.locator(`li[data-target='${spot!.col}/${spot!.row}']`);
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByTestId("ziel-wert")).toContainText("Lagebild", { timeout: 15000 });
    await expect(row.getByTestId("ziel-wert")).toContainText("Netto", { timeout: 20000 });
    await row.getByText("Details").click();
    await expect(row.getByTestId("nest-intel")).toBeVisible();
    await expectNoHorizontalOverflow(page, "Lohnende Ziele mit Werten");
  } finally {
    await seed.sql`delete from intel_sighting where kind = 'nest' and object_id = ${n.id}`;
    await seed.sql`delete from battle_report where nest_id = ${n.id}`;
    await seed.sql`delete from nest where id = ${n.id}`;
  }
});
