// Verwaltung → Fehlgeschlagene Ereignisse: Liste mit letztem Fehler, „Neu einreihen“ macht das Ereignis wieder fällig.
import { expect, expectNoHorizontalOverflow, test } from "./fixtures.ts";

test("Verwaltung: fehlgeschlagenes Ereignis ansehen und neu einreihen", async ({ page, player, seed }) => {
  await seed.sql`update player set is_admin = true where id = ${player.id}`;
  // Typ ohne Handler: tut nichts außer erneut zu scheitern (wird am Ende gelöscht).
  const [ev] = await seed.sql`
    insert into game_event (type, due_at, payload, status, attempts, last_error, base_id)
    values ('e2e_probe', now() - interval '1 hour', '{"e2e": true}'::jsonb, 'failed', 5, 'Error: e2e-Testfehler', null)
    returning id`;
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Menü", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Verwaltung/ }).click();
    await expect(page.getByRole("heading", { name: "Fehlgeschlagene Ereignisse", level: 2 })).toBeVisible();
    const row = page.getByTestId("admin-failed-events").getByRole("listitem").filter({ hasText: `#${ev.id}` });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Details" }).click();
    await expect(row.getByText(/e2e-Testfehler/)).toBeVisible();
    await expectNoHorizontalOverflow(page, "Verwaltung · Ereignisse");
    await row.getByRole("button", { name: "Neu einreihen" }).click();
    await expect(row).toHaveCount(0);
    const [after] = await seed.sql`select status, orig_due_at is not null as orig from game_event where id = ${ev.id}`;
    expect(after.status).toBe("pending");
    expect(after.orig).toBe(true);
  } finally {
    await seed.sql`delete from game_event where id = ${ev.id}`;
  }
});
