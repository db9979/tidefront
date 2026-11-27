// Berichte wie die E-Mail (Kopf, Kacheln, Tabellen mit Symbolen) und „Im Kampfsimulator öffnen“: Kampfbericht →
// Simulator zeigt die Einheiten des Berichts (frei änderbar), Startlink ?bericht=ID&sim=1 öffnet ihn direkt, fremde
// Berichte bleiben zu. Aufklärung (Nest) und Lieferung im selben Aufbau. Mit E2E_SHOTS=<Ordner> Bildschirmfotos (390 × 844).
import type { Page } from "@playwright/test";
import { balance } from "@tidefront/engine";
import { nestDefender, nestGarrison, resolveBattle, type Balance } from "@tidefront/game-core";
import { expect, expectNoHorizontalOverflow, test, type Player, type Seed } from "./fixtures.ts";

test.use({ viewport: { width: 390, height: 844 } });

const core = balance as unknown as Balance;

async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  // Hauptbereich bzw. Blatt scrollt selbst: Fenster kurz so hoch wie der Inhalt, dann zurück.
  const h = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll("main, [role=dialog] > div")).map((e) => e.scrollHeight)));
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.width, height: Math.min(5000, h + 260) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/${name}.png` });
  await page.setViewportSize(vp);
}

async function insertReport(seed: Seed, v: { kind: string; title: string; attacker: number | null; base: number | null; winner: string | null; seed: number | null; report: unknown }): Promise<number> {
  const [r] = await seed.sql`
    insert into battle_report (kind, title, attacker_player_id, defender_player_id, attacker_base_id, defender_base_id, nest_id, winner, seed, balance_version, report)
    values (${v.kind}, ${v.title}, ${v.attacker}, null, ${v.base}, null, null, ${v.winner}, ${v.seed}, ${String(balance.version)}, ${JSON.stringify(v.report)}::jsonb)
    returning id`;
  return r.id as number;
}

/** Echter Kampf gegen Nest Stufe 2 mit Wetter und eigenen Modifikatoren (wie ein Überfall ihn ablegt). */
async function battleReport(seed: Seed, player: Player): Promise<number> {
  const def = nestDefender(2, core);
  if (!def.ok) throw new Error(def.code);
  const attacker = { units: { korvette: 7, landungsschiff: 2, schuetzen: 40 }, modifiers: { attack: { see: 1.1 } } };
  const res = resolveBattle(attacker, def.defender, core, 777, { air: 0.85, strike: 0.9, wind: 0.6, clouds: 0.5, storm: false });
  if (!res.ok) throw new Error(res.code);
  return insertReport(seed, {
    kind: "ueberfall", title: "Überfall auf Piratennest Stufe 2", attacker: player.id, base: player.baseId, winner: res.report.winner, seed: 777,
    report: { battle: res.report, attackerName: player.name, defenderName: "Freibeuter-Kartell", targetName: "Piratennest Stufe 2", attacker },
  });
}

async function openReports(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: /^Meldungen/ }).click();
  await page.getByRole("tab", { name: /^Berichte/ }).click();
}

test("Kampfbericht wie die E-Mail; „Im Kampfsimulator öffnen“ zeigt die Einheiten des Berichts", async ({ page, player, seed }) => {
  await battleReport(seed, player);
  await page.goto("/");
  await openReports(page);
  await page.getByRole("button", { name: /Überfall auf Piratennest Stufe 2/ }).first().click();
  await expect(page.getByTestId("report-banner")).toContainText(/Sieg|Niederlage/);
  await expect(page.getByTestId("report-blocks")).toContainText("Korvette");
  await expect(page.getByTestId("report-blocks")).toContainText("Übrig");
  await expect(page.getByRole("heading", { name: "Gefechtsverlauf" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "Kampfbericht");
  await shot(page, "bericht-kampf");

  await page.getByRole("button", { name: "Im Kampfsimulator öffnen" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByTestId("report-sim")).toBeVisible();
  await expect(dlg.getByTestId("report-sim-real")).toContainText("Im echten Kampf");
  const korvette = dlg.getByRole("listitem").filter({ hasText: "Korvette" }).first().getByLabel("Anzahl");
  await expect(korvette).toHaveValue("7");
  await expect(dlg.getByRole("listitem").filter({ hasText: "Schützen" }).first().getByLabel("Anzahl")).toHaveValue("40");
  await expect(dlg.getByText("Siegchance")).toBeVisible();
  await expectNoHorizontalOverflow(page, "Simulator aus Bericht");
  await shot(page, "bericht-simulator");
  // Frei änderbar: eine Korvette mehr.
  await dlg.getByRole("listitem").filter({ hasText: "Korvette" }).first().getByRole("button", { name: "mehr" }).click();
  await expect(korvette).toHaveValue("8");
  await expect(dlg.getByText("Siegchance")).toBeVisible();
});

test("Startlink ?bericht=ID&sim=1 öffnet den vorbelegten Simulator; fremder Bericht bleibt zu", async ({ page, player, seed }) => {
  const id = await battleReport(seed, player);
  await page.goto(`/?tab=berichte&bericht=${id}&sim=1`);
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByTestId("report-sim")).toBeVisible();
  await expect(dlg.getByRole("listitem").filter({ hasText: "Korvette" }).first().getByLabel("Anzahl")).toHaveValue("7");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("report-banner")).toBeVisible();

  const foreign = await insertReport(seed, { kind: "ueberfall", title: "Fremder Bericht", attacker: null, base: null, winner: "attacker", seed: 1, report: {} });
  await page.goto(`/?tab=berichte&bericht=${foreign}&sim=1`);
  await expect(page.getByText("Bericht nicht gefunden.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Aufklärung (Nest) und Lieferung im Aufbau der E-Mail", async ({ page, player, seed }) => {
  const g = nestGarrison(3, core);
  if (!g.ok) throw new Error(g.code);
  await insertReport(seed, { kind: "aufklaerung", title: "Aufklärung: Piratennest Stufe 3", attacker: player.id, base: player.baseId, winner: null, seed: null, report: { nest: { level: 3, empty: false, garrison: g.nest } } });
  await insertReport(seed, { kind: "transport", title: "Lieferung an Hafen Nord", attacker: player.id, base: player.baseId, winner: null, seed: null, report: { from: "Hafen Süd", to: "Hafen Nord", cargo: { stahl: 1200, proviant: 300 } } });
  await page.goto("/");
  await openReports(page);

  await page.getByRole("button", { name: /Aufklärung: Piratennest Stufe 3/ }).first().click();
  await expect(page.getByTestId("report-banner")).toBeVisible();
  await expect(page.getByTestId("report-blocks")).toContainText("Besatzung");
  await expectNoHorizontalOverflow(page, "Aufklärungsbericht Nest");
  await shot(page, "bericht-aufklaerung-nest");
  await page.getByRole("button", { name: "Im Kampfsimulator öffnen" }).click();
  await expect(page.getByRole("dialog").getByText("Siegchance").or(page.getByRole("dialog").getByText("Angreifer wählen."))).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Zurück" }).click();

  await page.getByRole("button", { name: /Lieferung an Hafen Nord/ }).first().click();
  await expect(page.getByTestId("report-blocks")).toContainText("Stahl");
  await expect(page.getByRole("button", { name: "Im Kampfsimulator öffnen" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, "Lieferbericht");
  await shot(page, "bericht-lieferung");
});
