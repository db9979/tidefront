// Einstellbare Ruhezeit für Pushes: Vorgabe 23–7 Uhr, Uhrzeiten wählbar, abschaltbar; bleibt nach dem Neuladen.
import { expect, test } from "./fixtures.ts";

test("Einstellungen: Ruhezeit ändern und abschalten", async ({ page, player, seed }) => {
  await seed.sql`delete from server_setting where key = ${`push_quiet:${player.id}`}`; // Spieler je Worker geteilt
  try {
    const open = async () => {
      await page.goto("/");
      await page.getByRole("button", { name: "Menü", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: /^Einstellungen/ }).click();
      await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
    };
    await open();
    const on = page.getByRole("switch", { name: "Ruhezeit an" });
    const from = page.getByRole("combobox", { name: "Ruhezeit von" });
    const to = page.getByRole("combobox", { name: "Ruhezeit bis" });
    await expect(on).toHaveAttribute("aria-checked", "true");
    await expect(from).toHaveValue("23");
    await expect(to).toHaveValue("7");

    await from.selectOption("22");
    await expect(from).toHaveValue("22");
    await to.selectOption("6");
    await expect(to).toHaveValue("6");
    await on.click();
    await expect(on).toHaveAttribute("aria-checked", "false");
    await expect(from).toBeDisabled();

    await open();
    await expect(page.getByRole("switch", { name: "Ruhezeit an" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("combobox", { name: "Ruhezeit von" })).toHaveValue("22");
    await expect(page.getByRole("combobox", { name: "Ruhezeit bis" })).toHaveValue("6");
    const [row] = await seed.sql`select value from server_setting where key = ${`push_quiet:${player.id}`}`;
    expect(JSON.parse(row.value as string)).toEqual({ on: false, fromMin: 22 * 60, toMin: 6 * 60 });
  } finally {
    await seed.sql`delete from server_setting where key = ${`push_quiet:${player.id}`}`;
  }
});
