// Weltpolitik (docs/REGELN-WELTPOLITIK.md): Seerat-Abstimmung auf Basis → Lage (drei Knöpfe, eigene Stimme), Gesuch
// eines KI-Händlers bei den Tagesbefehlen annehmen (Liefervertrag, belegter Platz), Ansehen auf der KI-Karte unter
// Börse → Verträge (Stufe, Verlauf). Handy 390 px und Desktop 1440 px, jeweils ohne waagerechte Überbreite.
import type { Page } from "@playwright/test";
import { addBot, balance, dayKey, removeBotStep } from "@tidefront/engine";
import { settle, storageCapacity, type BaseState } from "@tidefront/game-core";
import { expect, expectNoHorizontalOverflow, test, type Player, type Seed } from "./fixtures.ts";
import { setBuildings, setResources, updateState } from "./game.ts";

const HOUR = 3_600_000;
const SHOTS = process.env.TF_POL_SHOTS ?? null; // Bildschirmfotos zur Sichtprüfung (Verzeichnis)

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function setup(seed: Seed, player: Player) {
  await setBuildings(seed.sql, player.baseId, { hafenkommandantur: 3, lagerkomplex: 6, kommandozentrale: 3 });
  await setResources(seed.sql, player.baseId, { stahl: 6000, treibstoff: 2000, elektronik: 1000, proviant: 3000 });
  // Wenig Taler: der Erlös muss in die Kasse passen (Pfand 25 % reicht).
  await seed.sql`update player set trader = jsonb_set(trader, '{credits}', '1000'::jsonb) where id = ${player.id}`;
  const bot = await addBot(seed.engine, "haendler");
  expect(bot.ok, JSON.stringify(bot)).toBe(true);
  const { playerId: botId, name } = bot as { playerId: number; name: string };
  await seed.sql`update player set bot_state = jsonb_set(bot_state, '{nextActAt}', '99999999999999'::jsonb), trader = jsonb_set(trader, '{credits}', '500000'::jsonb) where id = ${botId}`;
  const [kb] = await seed.sql`select id from base where player_id = ${botId}`;
  await updateState(seed.sql, kb.id as number, (s) => {
    s.buildings.lagerkomplex = 8;
    const cap = storageCapacity(settle(s as BaseState, Date.now(), balance), balance);
    s.resources = { ...s.resources, stahl: Math.floor(cap * 0.3), proviant: Math.floor(cap * 0.7) };
    s.resUpdatedAt = Date.now();
  });
  const [season] = await seed.sql`select id from season where status = 'running' order by number desc limit 1`;
  const seasonId = season.id as number;
  const now = Date.now();
  // Wochensitzung des Seerats, gerade offen (Wirkung danach; Ereignisse braucht die Abstimmung nicht).
  const idx = 100 + (player.id % 100000);
  const [w] = await seed.sql`insert into politik_fenster (season_id, slot, idx, effect, source, starts_at, ends_at)
    values (${seasonId}, 'woche', ${idx}, 'ruhig', 'plan', ${new Date(now + 2 * HOUR).toISOString()}::timestamptz, ${new Date(now + 50 * HOUR).toISOString()}::timestamptz) returning id`;
  const options = ["geleitschutz", "gebuehrensenkung", "gemeinsame_aktion", "ruhig"];
  const [sz] = await seed.sql`insert into seerat_sitzung (season_id, fenster_id, kind, options, status, opens_at, closes_at)
    values (${seasonId}, ${w.id}, 'woche', ${JSON.stringify(options)}::jsonb, 'offen', ${new Date(now - HOUR).toISOString()}::timestamptz, ${new Date(now + 2 * HOUR).toISOString()}::timestamptz) returning id`;
  // Ein erfülltes Gesuch (Ansehen +5; jetzt, damit es nach dem Saisonbeginn liegt) und ein offenes Angebot für heute.
  await seed.sql`insert into ki_gesuch (season_id, player_id, ki_id, day, kind, status, resource, qty, reward, value, offered_at, expires_at, closed_at)
    values (${seasonId}, ${player.id}, ${botId}, 'e2e-frueher', 'liefern', 'erfuellt', 'stahl', 500, ${JSON.stringify({ proviant: 100 })}::jsonb, 100,
      ${new Date(now - 60_000).toISOString()}::timestamptz, now(), now())`;
  const [g] = await seed.sql`insert into ki_gesuch (season_id, player_id, ki_id, day, kind, status, resource, qty, reward, value, offered_at, expires_at)
    values (${seasonId}, ${player.id}, ${botId}, ${dayKey(now)}, 'liefern', 'angeboten', 'stahl', 500, ${JSON.stringify({ proviant: 300 })}::jsonb, 300,
      ${new Date(now).toISOString()}::timestamptz, ${new Date(now + 24 * HOUR).toISOString()}::timestamptz)
    on conflict (season_id, player_id, day) do update set ki_id = excluded.ki_id, status = 'angeboten', resource = 'stahl', qty = 500,
      reward = excluded.reward, value = 300, expires_at = excluded.expires_at, contract_id = null, challenge_id = null
    returning id`;
  return { botId, name, sitzungId: sz.id as number, fensterId: w.id as number, gesuchId: g.id as number };
}

async function cleanup(seed: Seed, s: { botId: number; fensterId: number }, playerId: number) {
  await seed.sql`delete from ki_gesuch where player_id = ${playerId}`;
  await seed.sql`delete from politik_fenster where id = ${s.fensterId}`;
  await seed.sql`delete from market_contract where buyer_id = ${s.botId} or seller_id = ${s.botId}`;
  await removeBotStep(seed.engine, s.botId);
}

async function voteOnLage(page: Page, seed: Seed, player: Player, sitzungId: number, label: string) {
  const panel = page.getByTestId("politik-panel");
  await expect(panel).toBeVisible();
  const vote = panel.getByTestId("seerat-vote");
  await expect(vote).toContainText("Der Seerat tagt");
  await expect(vote).toContainText(/noch (1 h|2 h|\d+ min)/);
  await expect(page.getByTestId("lage-waiting").locator(`[data-lage-key="seerat:${sitzungId}"]`)).toBeVisible();
  await expectNoHorizontalOverflow(page, `${label} · Lage · Seerat`);
  await vote.scrollIntoViewIfNeeded();
  await shot(page, `${label}-seerat`);
  await vote.getByRole("button", { name: /^Geleitschutz/ }).click();
  await expect(vote.getByRole("button", { name: /^Geleitschutz/ })).toHaveAttribute("aria-pressed", "true");
  await expect(vote).toContainText("Deine Stimme zählt");
  const [v] = await seed.sql`select option from seerat_stimme where sitzung_id = ${sitzungId} and player_id = ${player.id}`;
  expect(v.option).toBe("geleitschutz");
  // Änderbar.
  await vote.getByRole("button", { name: /^Ruhige See/ }).click();
  await expect(vote.getByRole("button", { name: /^Ruhige See/ })).toHaveAttribute("aria-pressed", "true");
}

async function ansehenOnCard(page: Page, name: string, label: string, openMarket: () => Promise<void>) {
  await openMarket();
  await page.getByRole("tab", { name: "Verträge" }).click();
  const card = page.getByRole("region", { name });
  const a = card.getByTestId("ki-ansehen");
  await expect(a).toContainText("Bekannt");
  await expect(a).toContainText(/Bonus ±0 · Kontingent 25 %/);
  await a.getByRole("button", { name: "Verlauf" }).click();
  await expect(a.getByTestId("ki-ansehen-verlauf")).toContainText("Gesuch erfüllt");
  await a.scrollIntoViewIfNeeded();
  await shot(page, `${label}-ansehen`);
  await expectNoHorizontalOverflow(page, `${label} · Börse · Verträge · Ansehen`);
}

test("Weltpolitik am Handy: Seerat abstimmen, Gesuch annehmen, Ansehen beim KI-Händler", async ({ page, player, seed }) => {
  const s = await setup(seed, player);
  try {
    await page.goto("/");
    await voteOnLage(page, seed, player, s.sitzungId, "Handy");

    // Gesuch: Lage nennt es, angenommen wird bei den Tagesbefehlen.
    await expect(page.getByTestId("lage-waiting").locator(`[data-lage-key="gesuch:${s.gesuchId}"]`)).toContainText(`Gesuch von ${s.name}`);
    await page.getByRole("region", { name: "Aufträge" }).getByRole("button", { name: /^Tagesbefehle/ }).click();
    const offer = page.getByRole("dialog").getByTestId("gesuch-offer");
    await expect(offer).toContainText("Liefere 500 Stahl");
    await expect(offer).toContainText(/Angebot gilt noch (23 h|1 T|24 h)/);
    await expectNoHorizontalOverflow(page, "Handy · Tagesbefehle · Gesuch");
    await shot(page, "Handy-gesuch");
    await offer.getByRole("button", { name: "Annehmen" }).click();
    await expect(page.getByRole("dialog").getByTestId("gesuch-slot")).toContainText(`Für ${s.name}: 500 Stahl · Liefervertrag läuft`);
    await expect(page.getByRole("dialog").getByTestId("gesuch-slot")).toContainText(/fällig in/);
    const [g] = await seed.sql`select status, contract_id, challenge_id from ki_gesuch where id = ${s.gesuchId}`;
    expect(g.status).toBe("angenommen");
    expect(g.contract_id).not.toBeNull();
    const [dc] = await seed.sql`select kind from daily_challenge where id = ${g.challenge_id}`;
    expect(dc.kind).toBe("gesuch");
    await expectNoHorizontalOverflow(page, "Handy · Tagesbefehle · Gesuch angenommen");
    await page.keyboard.press("Escape");

    await ansehenOnCard(page, s.name, "Handy", () => page.getByRole("navigation").getByRole("button", { name: "Börse" }).click());
  } finally {
    await cleanup(seed, s, player.id);
  }
});

test.describe("Desktop 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test("Weltpolitik am Desktop: Seerat in der Seitenleiste, Ansehen auf der KI-Karte", async ({ page, player, seed }) => {
    const s = await setup(seed, player);
    try {
      await page.goto("/");
      await expect(page.getByTestId("desktop-side").getByTestId("lage-tab")).toBeVisible();
      await voteOnLage(page, seed, player, s.sitzungId, "Desktop");
      await ansehenOnCard(page, s.name, "Desktop", () => page.getByTestId("nav-rail").getByRole("button", { name: /^Börse/ }).click());
    } finally {
      await cleanup(seed, s, player.id);
    }
  });
});
