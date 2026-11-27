// „Was fehlt zum Sieg?“: Knopf im Probekampf (Missionsplanung) sucht im Web Worker den günstigsten Verband; „Ausbilden“
// springt nach Truppen → Ausbilden mit vorgewählten Mengen. Verlorener Kampfbericht: „Was hätte gefehlt?“.
// Handy-Breite 390 px ohne waagrechten Überlauf. Mit E2E_SHOTS=<Ordner> Bildschirmfotos.
import type { Page } from "@playwright/test";
import { balance } from "@tidefront/engine";
import { nestDefender, resolveBattle, type Balance } from "@tidefront/game-core";
import { expect, expectNoHorizontalOverflow, test, type Player, type Seed } from "./fixtures.ts";
import { setBuildings, setResources, setUnits } from "./game.ts";

test.use({ spawnNear: "nest", viewport: { width: 390, height: 844 } });

const core = balance as unknown as Balance;

async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  const h = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll("main, [role=dialog] > div")).map((e) => e.scrollHeight)));
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.width, height: Math.min(5000, h + 260) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/${name}.png` });
  await page.setViewportSize(vp);
}

test("Probekampf: „Was fehlt zum Sieg?“ nennt, was fehlt; „Ausbilden“ wählt die Mengen vor", async ({ page, player, seed }) => {
  test.slow();
  await setBuildings(seed.sql, player.baseId, { werft: 3, kaserne: 2, hafenkommandantur: 2, kommandozentrale: 5, radarstation: 8, kraftwerk: 6 });
  await setUnits(seed.sql, player.baseId, { korvette: 1, schuetzen: 4 });
  await setResources(seed.sql, player.baseId, { stahl: 50000, treibstoff: 20000, elektronik: 10000, proviant: 20000 });

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: /^Einsatz/ }).click();
  const targets = page.locator("section").filter({ has: page.getByRole("heading", { name: "Lohnende Ziele" }) });
  const first = targets.locator("li[data-target]").first();
  await expect(first.getByText(/^\d+ %$/)).toBeVisible({ timeout: 20000 }); // Vorschläge aus dem Worker
  await first.getByRole("button", { name: "Angreifen" }).click();
  await expect(page.getByRole("heading", { name: "Mission planen" })).toBeVisible();

  // Einschätzung und Probekampf nennen dieselbe Siegchance.
  await expect(page.getByTestId("einschaetzung")).toContainText(/Probekampf: \d+ % Sieg|Ohne Landungsschiff/, { timeout: 15000 });
  await page.getByRole("button", { name: "Probekampf", exact: true }).click();
  await expect(page.getByTestId("sim-siegchance")).toBeVisible();
  await page.getByRole("button", { name: "Was fehlt zum Sieg?" }).click();
  const result = page.getByTestId("win-search-result");
  await expect(result).toBeVisible({ timeout: 30000 });
  await expect(result).toContainText(/Es fehlen|Bestand reicht|Nicht erreichbar/);
  await expect(result).toContainText(/Siegchance \d+/);
  await expectNoHorizontalOverflow(page, "Was fehlt zum Sieg (Probekampf)");
  await shot(page, "was-fehlt-probekampf");

  // Ausbilden: Truppen → Ausbilden, die erste fehlende Einheit ist vorgewählt.
  const extra = await result.getByTestId("win-search-extra").textContent();
  expect(extra).toMatch(/^\+\d+ /);
  await result.getByRole("button", { name: "Ausbilden" }).click();
  await expect(page.getByRole("tab", { name: /^Ausbilden/ })).toHaveAttribute("aria-selected", "true");
  const preset = page.locator("li[data-train]").filter({ has: page.locator('input[aria-label="Anzahl"]:not([value="0"])') });
  await expect(preset.first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "Ausbilden vorgewählt");
});

async function lostReport(seed: Seed, player: Player): Promise<number> {
  const def = nestDefender(3, core);
  if (!def.ok) throw new Error(def.code);
  const attacker = { units: { korvette: 2, landungsschiff: 1, schuetzen: 12 } };
  const res = resolveBattle(attacker, def.defender, core, 4711);
  if (!res.ok) throw new Error(res.code);
  if (res.report.winner !== "defender") throw new Error("Testkampf sollte verloren sein");
  const [r] = await seed.sql`
    insert into battle_report (kind, title, attacker_player_id, defender_player_id, attacker_base_id, defender_base_id, nest_id, winner, seed, balance_version, report)
    values ('ueberfall', 'Überfall auf Piratennest Stufe 3', ${player.id}, null, ${player.baseId}, null, null, 'defender', 4711, ${String(balance.version)},
      ${JSON.stringify({ battle: res.report, attackerName: player.name, defenderName: "Freibeuter-Kartell", targetName: "Piratennest Stufe 3", attacker })}::jsonb)
    returning id`;
  return r.id as number;
}

test("Verlorener Kampfbericht: „Was hätte gefehlt?“ rechnet gegen das Ziel des Berichts", async ({ page, player, seed }) => {
  test.slow();
  await setBuildings(seed.sql, player.baseId, { werft: 3, kaserne: 2, kommandozentrale: 5 });
  await setUnits(seed.sql, player.baseId, { korvette: 2, landungsschiff: 1, schuetzen: 12 });
  await lostReport(seed, player);
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ }).click();
  await page.getByRole("tab", { name: /^Berichte/ }).click();
  await page.getByRole("button", { name: /Überfall auf Piratennest Stufe 3/ }).first().click();
  await expect(page.getByTestId("report-banner")).toContainText("Niederlage");
  await page.getByRole("button", { name: "Was hätte gefehlt?" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText("Was hätte gefehlt?")).toBeVisible();
  const result = dlg.getByTestId("win-search-result");
  await expect(result).toBeVisible({ timeout: 30000 });
  await expect(result).toContainText(/Es fehlen|Bestand reicht|Nicht erreichbar/);
  // Der nachgestellte Kampf darunter: eigene Seite, Phasen, Hinweis nur, wenn zutreffend.
  await expect(dlg.getByTestId("sim-phasen")).toBeVisible();
  await expect(dlg.getByTestId("sim-note")).not.toContainText("Schwachziel");
  await expectNoHorizontalOverflow(page, "Was hätte gefehlt (Bericht)");
  await shot(page, "was-haette-gefehlt");
});

test("Kampfsimulator: Kartell gegen den eigenen Hafen aus Sicht des Verteidigers, Stärke-Regler", async ({ page, player, seed }) => {
  await setBuildings(seed.sql, player.baseId, { werft: 2, kaserne: 2 });
  await setUnits(seed.sql, player.baseId, { korvette: 3, schuetzen: 40 });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Truppen" }).click();
  await page.getByRole("tab", { name: /^Einsatz/ }).click();
  await page.getByRole("button", { name: /^Kampfsimulator/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Kartell", exact: true }).click();
  await expect(dlg.getByTestId("sim-kartell")).toBeVisible();
  await expect(dlg.getByTestId("sim-hafen")).toBeVisible();
  await expect(dlg.getByText("Abwehrchance")).toBeVisible();
  await expect(dlg.getByText("Eigene Verluste (Verteidiger)")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Was fehlt zum Sieg?" })).toHaveCount(0); // nur für eigene Angriffe
  await dlg.getByLabel("Kartellstärke").focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight"); // 100 → 120 % (Schritt 5)
  await expect(dlg.getByText(/Kartellstärke 120 %/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "Simulator Kartell");
  await shot(page, "simulator-kartell");
  // Eigener Angriff: „Was fehlt zum Sieg?“ im freien Simulator.
  await dlg.getByRole("button", { name: "Eigene", exact: true }).click();
  await dlg.getByRole("combobox", { name: "Verteidiger" }).selectOption({ label: "Nest Stufe 2 (Mitte)" });
  await dlg.getByRole("button", { name: "Was fehlt zum Sieg?" }).click();
  await expect(dlg.getByTestId("win-search-result")).toBeVisible({ timeout: 30000 });
  await expectNoHorizontalOverflow(page, "Simulator Was fehlt");
});
