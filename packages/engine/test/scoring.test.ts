// Wertung v1.24: Kartell-Abwehr × npcDefenseFactor, Gewichtung nach Börsen-Richtpreis, Neuberechnung der laufenden
// Saison (Punkte werden aus den Daten abgeleitet, nicht gespeichert – zweimal rechnen ergibt dasselbe).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import { balance, chooseBase, computeStandings, register, reportScore, resValue, runningSeason, seed, unitValue, type Engine } from "../src/index.ts";

const f = balance.scoring!.npcDefenseFactor;
const price = balance.market.refPrice;

test("Richtpreis: Ressourcen, Einheiten und Anlagen zählen nach market.refPrice", () => {
  assert.equal(resValue({ stahl: 100 }), 100 * price.stahl);
  assert.equal(resValue({ elektronik: 100 }), 100 * price.elektronik);
  const all = 10 * (price.stahl + price.treibstoff + price.elektronik + price.proviant);
  assert.ok(Math.abs(resValue({ stahl: 10, treibstoff: 10, elektronik: 10, proviant: 10 }) - all) < 1e-9);
  // Elektronik zählt mehr als dieselbe Menge Stahl: kein Punktetausch über die Börse.
  assert.ok(resValue({ elektronik: 1000 }) > resValue({ stahl: 1000 }));
  const c = balance.units.korvette.cost ?? {};
  assert.equal(unitValue("korvette"), Object.entries(c).reduce((s, [r, n]) => s + n * (price[r] ?? 1), 0));
  const d = balance.defenses.bunkerlinie.cost ?? {};
  assert.equal(unitValue("bunkerlinie"), Object.entries(d).reduce((s, [r, n]) => s + n * (price[r] ?? 1), 0));
});

test("Kampfpunkte: Abwehr von Kartell und NPC nur × npcDefenseFactor, Spielerkämpfe und Nester voll", () => {
  assert.ok(f > 0 && f < 1);
  const boats = { schnellboot: 4 };
  const v = unitValue("schnellboot") * 4;
  // Kartell-Überfall auf einen Hafen (kein angreifender Spieler).
  const kartell = reportScore({ kind: "kartell", attackerPlayerId: null, defenderPlayerId: 7, al: boats, dl: {}, loot: { stahl: 500 } });
  assert.equal(kartell.attacker, null);
  assert.equal(kartell.defender!.kampf, v * f);
  // Großflotte greift einen Hafen an, Konvoi und Feld: ebenfalls ohne angreifenden Spieler.
  for (const kind of ["weltereignis", "konvoi", "feld"]) {
    assert.equal(reportScore({ kind, attackerPlayerId: null, defenderPlayerId: 7, al: boats, dl: {}, loot: null }).defender!.kampf, v * f, kind);
  }
  // Angriff auf Großflotte und Belagerungsring zählt als Abwehr, das Schatzschiff voll; Beute immer voll.
  for (const weKind of balance.scoring!.npcWorldEventKinds ?? []) {
    const r = reportScore({ kind: "weltereignis", weKind, attackerPlayerId: 7, defenderPlayerId: null, al: {}, dl: boats, loot: { stahl: 300 } });
    assert.equal(r.attacker!.kampf, v * f, weKind);
    assert.equal(r.attacker!.beute, resValue({ stahl: 300 }));
  }
  assert.equal(reportScore({ kind: "weltereignis", weKind: "schatzschiff", attackerPlayerId: 7, defenderPlayerId: null, al: {}, dl: boats, loot: null }).attacker!.kampf, v);
  // Nest und Spieler gegen Spieler: voll für beide Seiten.
  assert.equal(reportScore({ kind: "ueberfall", attackerPlayerId: 7, defenderPlayerId: null, al: {}, dl: boats, loot: null }).attacker!.kampf, v);
  const pvp = reportScore({ kind: "ueberfall", attackerPlayerId: 7, defenderPlayerId: 8, al: { korvette: 1 }, dl: { korvette: 2 }, loot: { elektronik: 100 } });
  assert.equal(pvp.attacker!.kampf, 2 * unitValue("korvette"));
  assert.equal(pvp.attacker!.beute, 100 * price.elektronik);
  assert.equal(pvp.defender!.kampf, unitValue("korvette"));
});

// ---------------------------------------------------------------- Neuberechnung gegen PostgreSQL

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 5);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const ids: number[] = [];

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  for (const [i, name] of ["Kai", "Lea"].entries()) {
    const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
    const r = await chooseBase(engine, p.playerId, `sc${i}-${Date.now()}`, { ...freeCoast(5 + i * 4), name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
    assert.equal(r.ok, true, JSON.stringify(r));
    const [b] = await db.select().from(tables.base).where(eq(tables.base.id, (r as { baseId: number }).baseId));
    const s = b.state as BaseState;
    s.buildings = {};
    s.units = {};
    s.defenses = {};
    await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, b.id));
    ids.push(p.playerId);
  }
});

after(async () => {
  await client.end();
});

test("Neuberechnung: alte Berichte (v1.23) zählen sofort nach den neuen Regeln, zweimal rechnen ergibt dasselbe", async () => {
  const season = (await runningSeason(db))!;
  const [kai, lea] = ids;
  const add = (kind: string, attacker: number | null, defender: number | null, battle: unknown, worldEvent?: unknown) =>
    db.insert(tables.battleReport).values({
      kind, title: "Test", attackerPlayerId: attacker, defenderPlayerId: defender, winner: "defender", balanceVersion: "v1.23",
      report: { battle, ...(worldEvent ? { worldEvent } : {}) }, createdAt: new Date(),
    });
  // Kai wehrt 40 Schnellboote des Kartells ab (alt: 10 000 Kampf-Kostenwert = 100 Punkte).
  await add("kartell", null, kai, { attacker: { losses: { schnellboot: 40 } }, defender: { losses: {} }, loot: {} });
  // Lea überfällt Kai: Kai verliert 2 Korvetten, Beute 1000 Elektronik.
  await add("ueberfall", lea, kai, { attacker: { losses: {} }, defender: { losses: { korvette: 2 } }, loot: { elektronik: 1000 } });
  // Lea schlägt die Großflotte: 8 Schnellboote.
  await add("weltereignis", lea, null, { attacker: { losses: {} }, defender: { losses: { schnellboot: 8 } }, loot: {} }, { kind: "grossflotte" });

  const first = await computeStandings(db, season.startsAt.getTime(), Date.now());
  const second = await computeStandings(db, season.startsAt.getTime(), Date.now());
  assert.deepEqual(second, first, "idempotent");
  const k = first.find((r) => r.playerId === kai)!;
  const l = first.find((r) => r.playerId === lea)!;
  const boat = unitValue("schnellboot");
  assert.equal(k.kampf, Math.floor((40 * boat * f) / 100));
  assert.equal(l.kampf, Math.floor((2 * unitValue("korvette") + 8 * boat * f) / 100));
  assert.equal(l.beute, Math.floor((1000 * price.elektronik) / 100));
  assert.equal(k.total, k.ausbau + k.militaer + k.kampf + k.beute + k.befehle);
});
