// Gefundene Fehler: Tests, die das erwartete Verhalten beschreiben und derzeit scheitern (test.fixme).
// Zum Prüfen eines Fixes `test.fixme` durch `test` ersetzen.
import { chooseBase, register } from "@tidefront/engine";
import { TRADE_PORTS, hexAtLonLat, hexIndex, terrainMap } from "@tidefront/world";
import { E2E } from "./env.ts";
import { expect, test, uniqueName } from "./fixtures.ts";

// Befund 1: Der Heimathafen lässt sich direkt auf das Feld eines Handelshafens legen.
// Server: packages/engine/src/commands.ts (chooseBase) prüft nur Küste und Nest, nicht den Handelshafen;
// Oberfläche: apps/web/src/screens/ChooseBase.tsx markiert das Feld als freie Küste. Die Gründung eines Außenpostens
// lehnt dasselbe Feld ab (game-core expansion.ts, foundingBlocker: „trade_port“). Folge: Börsenlieferungen kommen
// sofort an („Lieferzeit Konvoi: gleich“), ein Vorteil gegenüber allen anderen Spielern.
test.fixme("Befund 1: Heimathafen auf einem Handelshafen wird abgelehnt", async ({ seed }) => {
  const t = terrainMap();
  const taken = new Set((await seed.sql`select col, row from base union all select col, row from nest`).map((r) => `${r.col},${r.row}`));
  const port = TRADE_PORTS.map(([lon, lat, name]) => ({ ...hexAtLonLat(lon, lat), name }))
    .find((h) => t[hexIndex(h.col, h.row)] === "coast" && !taken.has(`${h.col},${h.row}`));
  expect(port, "freier Handelshafen auf Küste").toBeTruthy();
  const name = uniqueName("Port");
  const r = await register(seed.engine.db, { inviteCode: E2E.invite, name, password: "e2e-geheim-123" });
  const res = await chooseBase(seed.engine, r.playerId, `e2e-port-${name}`, {
    col: port!.col, row: port!.row, name: "Hafen am Kai", nightShieldStartHour: null, tzOffsetMinutes: 60,
  });
  expect(res, `Heimathafen auf ${port!.name} (${port!.col}/${port!.row})`).toEqual({ ok: false, code: "trade_port" });
});
