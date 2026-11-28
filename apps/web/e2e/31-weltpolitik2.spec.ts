// Weltpolitik Stufe 2 (docs/REGELN-WELTPOLITIK.md 3a) und Lagebild 5.6: der eigene Ruf unter Meldungen → Saison → Welt
// (Stufe, Wert, Verlauf) und als Zeichen in der Rangliste; der optische Satellit sieht beim Überflug einen getauchten
// U-Boot-Verband (Karte → Sichtungen). Handy 390 px ohne waagerechte Überbreite.
import { addBot } from "@tidefront/engine";
import { weatherAt } from "@tidefront/game-core";
import { COLS, ROWS, hexCenter, hexCenterXY } from "@tidefront/world";
import { expect, expectNoHorizontalOverflow, test, until } from "./fixtures.ts";
import { readState, setBuildings, setResources, updateState } from "./game.ts";

const H = 3_600_000;

test("Ruf: Saison → Welt zeigt Stufe, Wert und Verlauf; Rangliste das Zeichen „Berüchtigt“", async ({ page, player, seed }) => {
  // Seit 30 Tagen angemeldet (kein Anfängerschutz des Rufs); drei Vertragsstrafen = −30 → berüchtigt.
  await seed.sql`update player set created_at = now() - interval '30 days' where id = ${player.id}`;
  for (let i = 0; i < 3; i++) {
    await seed.sql`insert into market_contract (kind, status, seller_id, buyer_id, proposer_id, resource, qty, buyer_unit, seller_unit, course, delivery,
        due_at, settle_at, closed_at, seller_penalty_cents, created_at)
      values ('spieler', 'teilweise', ${player.id}, ${player.id}, ${player.id}, 'stahl', 100, 1, 1, 1, 'abstrakt',
        now(), now(), now(), 5000, now())`; // jetzt: nach dem Saisonbeginn (der Testlauf hat die Saison gerade erst gestartet)
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?tab=welt");
  const card = page.getByTestId("ruf-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Dein Ruf");
  await expect(card).toContainText("Berüchtigt");
  await expect(page.getByTestId("ruf-value")).toHaveText("−30");
  await expect(card).toContainText("Händler und Festung schließen nichts mit dir ab");
  await expect(card).toContainText("ändert keine Börsenpreise");
  await card.getByRole("button", { name: "Verlauf" }).click();
  await expect(page.getByTestId("ruf-verlauf").getByText("Vertragsstrafe")).toHaveCount(3);
  await expectNoHorizontalOverflow(page, "Ruf unter Saison → Welt");

  await page.goto("/?tab=rangliste");
  // Eigener Eintrag mit Wert (bei anderen nur das Zeichen).
  await expect(page.getByTestId("ruf-mark").filter({ hasText: "Berüchtigt −30" })).toHaveCount(1);
  await expectNoHorizontalOverflow(page, "Rangliste mit Ruf");
});

test("Optischer Satellit: Überflug zeigt einen getauchten U-Boot-Verband unter Karte → Sichtungen", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { kommandozentrale: 8, forschungsamt: 5, radarstation: 6, kraftwerk: 8, lagerkomplex: 10, startrampe: 1 });
  await setResources(seed.sql, player.baseId, { stahl: 40000, treibstoff: 20000, elektronik: 30000 });
  await updateState(seed.sql, player.baseId, (s) => { s.research = { ...(s.research ?? {}), levels: { ...(s.research?.levels ?? {}), optischer_satellit: 1 }, order: null }; });
  await page.goto("/?tab=sichtungen");
  const launch = page.getByTestId("sat-launch");
  await launch.getByRole("button", { name: "Starten" }).first().click();
  await expect(page.getByTestId("sat-next")).toContainText(/nächster Überflug in (5|6) h/);
  const sat = ((await readState(seed.sql, player.baseId)).satellites as { id: number; launchedAtMs: number; x0: number }[])[0];

  // Ein U-Boot-Verband (Besitzer: ein KI-Spieler, der hier nichts tut) liegt zum Überflug auf einem klaren Feld im Streifen.
  const passAt = Date.now() + 8000;
  const wb = (await import("@tidefront/engine")).balance.weather!;
  let spot: { col: number; row: number } | null = null;
  let best = 1;
  for (let row = 1; row < ROWS - 1 && !spot; row++) for (let col = 0; col < COLS && !spot; col++) {
    const p = hexCenterXY(col, row);
    if (Math.abs(p.x - sat.x0) > 250 || Math.abs(row - player.row) < 4) continue;
    const c = weatherAt(hexCenter(col, row), passAt, wb).clouds;
    best = Math.min(best, c);
    if (c < 0.45) spot = { col, row };
  }
  test.skip(!spot, `kein klares Feld im Streifen (Wetter zur Laufzeit, geringste Bewölkung ${best.toFixed(2)}, x0 ${sat.x0})`);
  const bot = await addBot(seed.engine, "freibeuter");
  expect(bot.ok, JSON.stringify(bot)).toBe(true);
  const botId = (bot as { playerId: number }).playerId;
  await seed.sql`update player set bot_state = jsonb_set(bot_state, '{nextActAt}', '99999999999999'::jsonb) where id = ${botId}`;
  const [kb] = await seed.sql`select id from base where player_id = ${botId}`;
  await seed.sql`insert into mission (player_id, base_id, type, target_kind, target_col, target_row, plan, status, arrive_at)
    values (${botId}, ${kb.id as number}, 'aufklaerung', 'hex', ${spot!.col}, ${spot!.row},
      ${JSON.stringify({ units: { uboot: 3 }, departAtMs: passAt - 200 * H })}::jsonb, 'outbound', ${new Date(passAt + 30 * 60_000).toISOString()}::timestamptz)`;

  // Überflug vorziehen: Start des ersten Überflugs in 8 s (Zustand und Ereignisse um die Differenz früher).
  const shift = sat.launchedAtMs + 6 * H - passAt;
  await updateState(seed.sql, player.baseId, (s) => {
    for (const x of s.satellites) { x.launchedAtMs -= shift; x.expiresAtMs -= shift; }
  });
  await seed.sql`update game_event set due_at = due_at - ${shift} * interval '1 millisecond'
                 where base_id = ${player.baseId} and type in ('satellite_pass', 'satellite_end') and status = 'pending'`;
  await until(async () => ((await readState(seed.sql, player.baseId)).satellites?.[0]?.passes ?? 0) >= 1, "Überflug verarbeitet", 40000);

  await page.setViewportSize({ width: 390, height: 844 });
  const tab = page.getByTestId("lagebild-tab");
  // Unter Last wird das Wissen des Überflugs etwas später geschrieben: bei Bedarf neu laden.
  await expect(async () => {
    await page.goto("/?tab=sichtungen");
    await expect(tab.getByText(/U-Boot-Verband \(unbekannt\) · klein/).first()).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });
  await expect(tab).toContainText("Optischer Satellit");
  await expectNoHorizontalOverflow(page, "Sichtungen mit U-Boot-Verband");
  await seed.sql`delete from mission where player_id = ${botId}`;
});
