// Spieler gegen Spieler: Kopfgeld auf Rang 1 sichtbar in Rangliste, Kartenblatt und Missionsplanung; vor dem ersten
// Überfall auf einen Spielerhafen warnt die Planung, dass der eigene Anfängerschutz damit endet.
import { register, chooseBase } from "@tidefront/engine";
import { COLS, ROWS, hexDistanceKm, hexIndex, nearestTradePort, terrainMap } from "@tidefront/world";
import { E2E } from "./env.ts";
import { awayFromEdge, expect, expectNoHorizontalOverflow, tapHex, test, uniqueName } from "./fixtures.ts";
import { setUnits, updateState } from "./game.ts";

test("Kopfgeld auf die Spitze: Rangliste, Kartenblatt und Missionsplanung", async ({ page, player, seed }) => {
  // Zielspieler in der Nähe, mit großer Flotte klar auf Rang 1, ohne Anfängerschutz.
  const taken = new Set((await seed.sql`select col, row from base union all select col, row from nest union all select col, row from resource_field`).map((r) => `${r.col},${r.row}`));
  const t = terrainMap();
  const spots: { col: number; row: number; d: number }[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (t[hexIndex(col, row)] !== "coast" || taken.has(`${col},${row}`) || !awayFromEdge({ col, row })) continue;
    if (nearestTradePort({ col, row }).distanceKm < 1) continue;
    const d = hexDistanceKm(player, { col, row });
    if (d >= 60 && d <= 260) spots.push({ col, row, d });
  }
  spots.sort((a, b) => a.d - b.d);
  const name = uniqueName("Spitze");
  const r = await register(seed.engine.db, { inviteCode: E2E.invite, name, password: "e2e-geheim-123" });
  let target: { col: number; row: number } | null = null;
  for (const h of spots.slice(0, 30)) {
    const res = await chooseBase(seed.engine, r.playerId, `e2e-${name}-${h.col}-${h.row}`, { col: h.col, row: h.row, name: `Hafen ${name.slice(7)}`, nightShieldStartHour: null, tzOffsetMinutes: 60 });
    if (res.ok) { target = h; break; }
  }
  expect(target, "Küstenfeld für den Zielspieler").toBeTruthy();
  const [tb] = await seed.sql`select id from base where player_id = ${r.playerId} and is_home`;
  await setUnits(seed.sql, tb.id as number, { korvette: 4000 });
  await updateState(seed.sql, tb.id as number, (s) => { s.protection.createdAtMs = 0; });
  // Eigener Verband für die Planung; der eigene Hafen steht noch im Anfängerschutz (neuer Spieler).
  await setUnits(seed.sql, player.baseId, { korvette: 3 });
  // Rang-Momentaufnahme des Tages neu rechnen lassen (sonst gilt der Stand von heute früh).
  await seed.sql`delete from server_setting where key = 'pvp_rank_snapshot'`;

  // Rangliste: Kopfgeld-Kennzeichen neben dem Namen.
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ }).click();
  await page.getByRole("tablist", { name: "Meldungen" }).getByRole("tab", { name: /^Rangliste/ }).click();
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row.getByTestId("bounty-mark")).toHaveText("+50 %");
  await expectNoHorizontalOverflow(page, "Rangliste mit Kopfgeld");
  await row.getByRole("button").click();
  await expect(page.getByText("Kopfgeld +50 %").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Karte: Blatt des fremden Hafens nennt das Kopfgeld.
  await page.getByRole("navigation").getByRole("button", { name: "Karte" }).click();
  await tapHex(page, player, target!);
  await expect(page.getByTestId("pvp-hint").getByText(/Kopfgeld \+50 %/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Karte mit Kopfgeld");
  await page.getByRole("button", { name: "Mission planen" }).click();

  // Missionsplanung: Kopfgeld, Mutfaktor und die Warnung zum Anfängerschutz.
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();
  const hint = page.getByTestId("pvp-hint");
  await expect(hint.getByText(/Kopfgeld \+50 %/)).toBeVisible();
  await expect(hint.getByText(/Mutfaktor ×1,50/)).toBeVisible();
  await expect(page.getByTestId("beginner-ends")).toContainText("Dein Anfängerschutz endet damit");
  await expectNoHorizontalOverflow(page, "Missionsplanung mit Kopfgeld");
});
