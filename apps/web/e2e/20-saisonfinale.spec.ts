// Saisonfinale „Leviathan“: Ankündigung (Banner mit Countdown), dann die Armada auf der Karte (Lebensbalken) und
// „Angriff planen“ mit Vorschau (Abschnitt, Siegchance, Beute) bis zum Auslaufen. Das Ereignis wird direkt in der
// Test-DB angelegt (ohne Systemnachricht an alle), damit parallele Tests nichts davon merken; am Ende beendet.
import { COLS, ROWS, hexDistanceKm, terrainAt } from "@tidefront/world";
import { expect, expectNoHorizontalOverflow, tapHex, test } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

/** Seefeld 120–300 km vom Hafen (Sammelpunkt in Sichtweite). */
function seaNear(h: { col: number; row: number }): { col: number; row: number } {
  let best: { col: number; row: number; d: number } | null = null;
  for (let row = Math.max(8, h.row - 5); row <= Math.min(ROWS - 9, h.row + 5); row++) {
    for (let col = Math.max(8, h.col - 5); col <= Math.min(COLS - 9, h.col + 5); col++) {
      if (terrainAt(col, row) !== "sea") continue;
      const d = hexDistanceKm(h, { col, row });
      if (d >= 120 && d <= 300 && (!best || d < best.d)) best = { col, row, d };
    }
  }
  if (!best) throw new Error("kein Seefeld in der Nähe");
  return best;
}

test("Saisonfinale: Ankündigung mit Countdown, Armada auf der Karte, Angriff planen mit Abschnitt und Siegchance", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 6, hafenkommandantur: 4, kommandozentrale: 6, radarstation: 6, kraftwerk: 8 });
  await setUnits(seed.sql, player.baseId, { korvette: 20, zerstoerer: 4 });
  await setResources(seed.sql, player.baseId, { treibstoff: 40000 });
  const at = seaNear(player);
  const vanguards: unknown[] = [];
  const finale = { totalHp: 0, participants: 0, vanguards, allianceHp: {} };
  const [ev] = await seed.sql`
    insert into world_event (kind, status, season_id, col, row, units, initial_units, data, starts_at, active_at, ends_at)
    values ('finale', 'announced', null, ${at.col}, ${at.row}, '{}'::jsonb, '{}'::jsonb,
      ${JSON.stringify({ initialHp: 0, strength: 1, finale })}::jsonb, now(), now() + interval '2 hours', now() + interval '74 hours')
    returning id`;
  try {
    // Ankündigung: Banner auf der Basis mit Countdown.
    await page.goto("/");
    const banner = page.getByTestId("finale-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Saisonfinale: Kartell-Armada angekündigt");
    await expect(banner).toContainText(/erscheint in \d/);
    await expectNoHorizontalOverflow(page, "Basis mit Finale-Banner");

    // Erscheinen: 400 Schnellboote, 40 Sektionen (wie finale_appear, ohne Nachricht an alle).
    const units = { schnellboot: 400, piratenmiliz: 3200, flaggschiff: 40 };
    const hp = 400 * 240 + 40 * 1000;
    await seed.sql`
      update world_event set status = 'active', active_at = now() - interval '1 minute', units = ${JSON.stringify(units)}::jsonb,
        initial_units = ${JSON.stringify(units)}::jsonb,
        data = ${JSON.stringify({ initialHp: hp, strength: 1, finale: { ...finale, totalHp: hp, participants: 1 } })}::jsonb
      where id = ${ev.id}`;
    await page.reload();
    await expect(page.getByTestId("finale-banner")).toContainText("vor der Küste");

    // Karte: Armada antippen, Info-Blatt mit Lebensbalken.
    await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
    await tapHex(page, player, at);
    const card = page.getByTestId("finale-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("finale-lifebar")).toContainText("400 von 400 Schnellbooten");
    await expectNoHorizontalOverflow(page, "Karte mit Finale-Blatt");
    await card.getByRole("button", { name: "Angriff planen" }).click();

    // Planen: Vorschau mit Abschnitt (0,5 × K / 80 Boote), Siegchance und Beute.
    await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
    const unitRow = (name: string) => page.getByRole("listitem").filter({ hasText: new RegExp(`^${name}\\d`) });
    await unitRow("Korvette").getByRole("button", { name: "alle" }).click();
    await unitRow("Zerstörer").getByRole("button", { name: "alle" }).click();
    const preview = page.getByTestId("finale-preview");
    await expect(preview).toBeVisible();
    const k = 20 * 200 + 4 * 450;
    await expect(preview).toContainText(`${Math.round((0.5 * k) / 80)} Schnellboote`);
    await expect(preview).toContainText(/Siegchance: \d+ %/);
    await expect(preview).toContainText(/Beute \(bei der Heimkehr\): [\d.]+ Stahl/);
    await expectNoHorizontalOverflow(page, "Missionsplanung Finale");
    await page.getByRole("button", { name: "Auslaufen" }).click();
    await expect(page.getByRole("heading", { name: "Mission gestartet" })).toBeVisible();
    const [m] = await seed.sql`select target_kind, target_id from mission where player_id = ${player.id} order by id desc limit 1`;
    expect(m.target_kind).toBe("event");
    expect(m.target_id).toBe(ev.id);
  } finally {
    await seed.sql`update world_event set status = 'ended', outcome = 'test', ended_at = now() - interval '7 hours' where id = ${ev.id}`;
    await seed.sql`delete from market_news where key = ${`we:${ev.id}`}`; // Börse der parallelen Tests unberührt
  }
});
