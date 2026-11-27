// Verwaltung → Statistik, Balance live (Welle 2): Rohstoffbilanz aus dem Tagesschnappschuss, Zuflüsse, Welt & Worker mit
// Schrittdauer des Workers, Nutzung je System und Meilensteine mit Soll und Nenner.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

test("Verwaltung: Rohstoffbilanz, Zuflüsse, Welt & Worker, Nutzung je System, Meilensteine mit Soll", async ({ page, player, seed }) => {
  await seed.sql`update player set is_admin = true where id = ${player.id}`;
  // Ein langsamer Lauf eines erdachten Schritts (heute), damit die Schrittdauer sichtbar ist.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TZ && !process.env.TZ.startsWith(":") ? process.env.TZ : "Europe/Berlin" }).format(new Date());
  await seed.sql`insert into worker_step_day (day, step, runs, total_ms, max_ms, slow, errors) values (${day}, 'e2e probe', 2, 2600, 2500, 1, 0)
    on conflict (day, step) do update set runs = 2, total_ms = 2600, max_ms = 2500, slow = 1`;
  // Tagesschnappschuss des eigenen Hafens (der Worker schreibt ihn nur in der ersten Wartungsrunde des Tages).
  await seed.sql`insert into base_day (day, base_id, player_id, bot, resources, per_hour, capacity, levels, kz, military, credits)
    values (${day}, ${player.baseId}, ${player.id}, false, ${JSON.stringify({ stahl: 2400, treibstoff: 1200, elektronik: 600, proviant: 1300 })}::jsonb,
      ${JSON.stringify({ stahl: 20, treibstoff: 10, elektronik: 5, proviant: 15 })}::jsonb, 5000, 0, 0, 0, 0)
    on conflict (day, base_id) do nothing`;
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Menü", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Verwaltung/ }).click();
    const bilanz = page.getByRole("heading", { name: "Rohstoffbilanz", level: 2 });
    await bilanz.scrollIntoViewIfNeeded();
    await expect(bilanz).toBeVisible({ timeout: 20000 });
    const card = (name: string | RegExp) => page.locator("section").filter({ has: page.getByRole("heading", { name, level: 2 }) });
    await expect(card("Rohstoffbilanz").getByRole("cell", { name: /Stahl/ }).first()).toBeVisible();
    await expect(card(/^Zuflüsse/).getByRole("cell", { name: "Produktion" })).toBeVisible();
    const worker = card("Welt & Worker");
    await expect(worker.getByRole("cell", { name: "e2e probe" })).toBeVisible();
    await expect(card("Nutzung je System")).toBeVisible();
    const ms = card("Meilensteine");
    await expect(ms.getByRole("columnheader", { name: "Soll" }).or(ms.getByText("Noch keine Meilensteine in dieser Saison."))).toBeVisible();
    await expectNoHorizontalOverflow(page, "Verwaltung · Balance");
  } finally {
    await seed.sql`delete from worker_step_day where step = 'e2e probe'`;
    await seed.sql`delete from base_day where base_id = ${player.baseId}`;
  }
});
