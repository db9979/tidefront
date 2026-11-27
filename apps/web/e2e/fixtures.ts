// Gemeinsame Bausteine der End-to-End-Tests: Datenbankzugriff auf die Test-DB, Spieler samt Hafen anlegen
// (ohne Oberfläche, für Abläufe nach der Anmeldung), Konsolenfehler sammeln, Layout-Prüfung bei 390 px.
import { randomBytes } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import Valkey from "iovalkey";
import { createDb } from "@tidefront/db";
import { chooseBase, register, type Engine } from "@tidefront/engine";
import { COLS, ROWS, hexAtLonLat, hexCenter, hexCenterXY, hexDistanceKm, hexIndex, nearestTradePort, terrainMap } from "@tidefront/world";
import { E2E } from "./env.ts";
import { foundingSpot } from "./game.ts";

export { expect };

type Sql = ReturnType<typeof postgres>;

export interface Seed {
  sql: Sql;
  engine: Engine;
}

export interface Player {
  id: number;
  name: string;
  password: string;
  baseId: number;
  col: number;
  row: number;
}

/** Konsolenmeldungen, die kein Fehler der App sind (Grafiktreiber im kopflosen Chromium). */
const IGNORED = [/GL Driver Message/i, /WebGL/i, /GPU stall/i];

/** Eindeutiger, gültiger Spielername (3–24 Zeichen). */
export function uniqueName(prefix: string): string {
  return `${prefix} ${randomBytes(5).toString("hex")}`.slice(0, 24);
}

/** Freie Küstenfelder, nach Abstand zum Wunschort sortiert. */
async function freeCoastNear(sql: Sql, lon: number, lat: number): Promise<{ col: number; row: number }[]> {
  const taken = new Set<string>();
  for (const r of await sql`select col, row from base union all select col, row from nest union all select col, row from resource_field`) {
    taken.add(`${r.col},${r.row}`);
  }
  const t = terrainMap();
  const target = hexAtLonLat(lon, lat);
  const out: { col: number; row: number; d: number }[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (t[hexIndex(col, row)] !== "coast" || taken.has(`${col},${row}`)) continue;
    // Handelshäfen meiden: der Server ließe den Heimathafen dort zu (siehe 10-befunde.spec.ts), Lieferungen kämen sofort.
    if (nearestTradePort({ col, row }).distanceKm < 1) continue;
    out.push({ col, row, d: hexDistanceKm(target, { col, row }) });
  }
  return out.sort((a, b) => a.d - b.d);
}

/**
 * Wunschorte für neue Spieler: weit genug auseinander, damit sich Tests nicht stören, und nicht an den Orten der
 * Schnellwahl (die nutzt der Anmeldetest über die Oberfläche).
 */
const SPOTS: [number, number][] = [
  [-1.6, 47.2], [3.2, 51.3], [8.6, 53.9], [-8.4, 43.4], [-0.4, 39.5], [2.2, 41.4], [9.0, 44.4], [15.3, 40.6],
  [23.7, 37.9], [-6.3, 53.3], [-3.0, 56.0], [11.9, 57.7], [18.1, 59.3], [24.9, 60.2], [-66.1, 18.4], [-80.1, 25.8],
];
let spot = 0;

/** "founding": wie "spot", aber nur Hafenlagen, neben denen noch ein freies Gründungsfeld liegt (Außenposten, Radarposten, Seekabel). */
export type SpawnNear = "spot" | "nest" | "field" | "founding";

/** Abseits des Kartenrands (dort lässt sich die Karte nicht weit genug verschieben, um ein Feld frei anzutippen). */
export function awayFromEdge(h: { col: number; row: number }): boolean {
  return h.col >= 8 && h.col < COLS - 8 && h.row >= 8 && h.row < ROWS - 8;
}

/** Wunschort: Spot-Liste oder neben einem zufälligen, unbesiegten Nest bzw. freien Rohstofffeld der Stufe 1. */
async function spawnPoint(sql: Sql, near: SpawnNear): Promise<[number, number]> {
  if (near !== "spot") {
    const rows = near === "nest"
      ? await sql`select col, row from nest where level = 1 and defeated_at is null`
      : await until(async () => {
        const r = await sql`select col, row from resource_field where tier = 1 and player_id is null`;
        return r.length > 0 ? r : null;
      }, "Rohstofffelder angelegt");
    const inner = rows.filter((r) => awayFromEdge({ col: r.col as number, row: r.row as number }));
    const n = inner[Math.floor(Math.random() * inner.length)];
    const c = hexCenter(n.col as number, n.row as number);
    return [c.lon, c.lat];
  }
  const spots = SPOTS.filter(([lon, lat]) => awayFromEdge(hexAtLonLat(lon, lat)));
  return spots[(spot++ + Math.floor(Math.random() * spots.length)) % spots.length];
}

export const test = base.extend<{ player: Player; consoleErrors: string[]; spawnNear: SpawnNear }, { seed: Seed }>({
  spawnNear: ["spot", { option: true }],

  seed: [async ({}, use) => {
    const { db, client } = createDb(E2E.databaseUrl, 3);
    const engine: Engine = { db, notify: () => {}, log: () => {} };
    await use({ sql: client, engine });
    await client.end();
  }, { scope: "worker" }],

  // Jede Seite: Konsolenfehler und unbehandelte Ausnahmen sammeln; am Ende muss die Liste leer sein.
  consoleErrors: [async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (IGNORED.some((re) => re.test(t))) return;
      errors.push(`console.error: ${t}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await use(errors);
    if (!testInfo.annotations.some((a) => a.type === "console-errors-allowed")) {
      expect(errors, "keine Konsolenfehler").toEqual([]);
    }
  }, { auto: true }],

  // Spieler mit Heimathafen direkt in der Test-DB (über die Engine, ohne Ratenbegrenzung der Anmeldung),
  // angemeldet per Sitzungs-Cookie; Begrüßung als gesehen markiert.
  player: async ({ seed, context, spawnNear }, use) => {
    const name = uniqueName("Kpt");
    const password = "e2e-geheim-123";
    const r = await register(seed.engine.db, { inviteCode: E2E.invite, name, password });
    let chosen: { col: number; row: number } | null = null;
    for (let attempt = 0; attempt < (spawnNear === "founding" ? 8 : 1) && !chosen; attempt++) {
    const [lon, lat] = await spawnPoint(seed.sql, spawnNear === "founding" ? "spot" : spawnNear);
    for (const h of (await freeCoastNear(seed.sql, lon, lat)).slice(0, 40)) {
      if (spawnNear === "founding" && !(await foundingSpot(seed.sql, h).then(() => true, () => false))) continue;
      const res = await chooseBase(seed.engine, r.playerId, `e2e-${name}-${h.col}-${h.row}`, {
        col: h.col, row: h.row, name: `Hafen ${name.slice(4)}`, nightShieldStartHour: null, tzOffsetMinutes: 60,
      });
      if (res.ok) { chosen = h; break; }
    }
    }
    if (!chosen) throw new Error("kein freies Küstenfeld gefunden");
    const [b] = await seed.sql`select id from base where player_id = ${r.playerId} and is_home`;
    await context.addCookies([{ name: "tf_session", value: r.token, url: E2E.webUrl }]);
    await context.addInitScript(() => localStorage.setItem("tf-welcome-v1", "1"));
    await use({ id: r.playerId, name, password, baseId: b.id as number, ...chosen });
  },
});

/**
 * Bildschirm prüfen: kein waagerechtes Überlaufen bei Handybreite. Geprüft werden das Dokument und der
 * Hauptbereich (der waagerechten Überlauf abschneidet, sonst bliebe er unsichtbar) sowie offene Blätter/Dialoge.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string, opts: { soft?: boolean } = {}): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  const res = await page.evaluate(() => {
    const vw = window.innerWidth;
    const out: string[] = [];
    const de = document.documentElement;
    if (de.scrollWidth > vw + 1) out.push(`document ${de.scrollWidth} > ${vw}`);
    if (document.body.scrollWidth > vw + 1) out.push(`body ${document.body.scrollWidth} > ${vw}`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main, [role=dialog]"))) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "auto" && cs.overflowX !== "scroll") {
        out.push(`${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""} ${el.scrollWidth} > ${el.clientWidth}`);
      }
      // Sichtbare Kinder, die rechts aus dem Bildschirm ragen (ohne waagerechte Schiebeleisten).
      for (const c of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
        const r = c.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
        let scroller = false;
        for (let p = c.parentElement; p && p !== el.parentElement; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "auto" || o === "scroll") { scroller = true; break; }
        }
        if (scroller || getComputedStyle(c).position === "fixed") continue;
        out.push(`ragt heraus: <${c.tagName.toLowerCase()} class="${(c.className as unknown as string).toString().slice(0, 60)}"> right=${Math.round(r.right)} text="${(c.textContent ?? "").trim().slice(0, 40)}"`);
        if (out.length > 8) break;
      }
    }
    return { vw, out };
  });
  (opts.soft ? expect.soft : expect)(res.out, `${label}: kein waagerechtes Überlaufen bei ${res.vw} px`).toEqual([]);
}

/** Wartet, bis die Bedingung (z. B. eine DB-Abfrage) wahr ist. */
export async function until<T>(fn: () => Promise<T | null | undefined | false>, what: string, timeoutMs = 20000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Zeitüberschreitung: ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Feld auf der Pixi-Karte antippen. Die Karte zeichnet ins Canvas; Ziel ist deshalb eine Pixelposition. Start:
 * Kartenmitte = `center`, Maßstab geschätzt. Die Karte wird so verschoben, dass das Ziel in der freien Mitte liegt
 * (oben liegen Wetter- und Zoomknöpfe, unten das Infoblatt); danach anhand der angezeigten Feldnummer („Feld c/r“)
 * nachführen.
 */
export async function tapHex(page: Page, center: { col: number; row: number }, target: { col: number; row: number }, opts: { scale?: number } = {}): Promise<void> {
  const canvas = page.locator("main canvas").first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500); // Pixi-Szene zentriert sich nach dem ersten Bild
  const box = (await canvas.boundingBox())!;
  const t = hexCenterXY(target.col, target.row);
  const c0 = hexCenterXY(center.col, center.row);
  const scale = opts.scale ?? 0.35;
  const aim = { x: box.width / 2, y: box.height * 0.4 };
  let x = box.width / 2 + (t.x - c0.x) * scale;
  let y = box.height / 2 + (t.y - c0.y) * scale;
  for (let i = 0; i < 6; i++) {
    // Ziel in die freie Mitte schieben (Ziehen in der Mitte des Canvas).
    const dx = aim.x - x;
    const dy = aim.y - y;
    if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
      const sx = box.x + box.width / 2;
      const sy = box.y + box.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx + dx, sy + dy, { steps: 8 });
      await page.mouse.up();
      x += dx;
      y += dy;
      await page.waitForTimeout(150);
    }
    await page.mouse.click(box.x + x, box.y + y);
    const line = page.getByText(/Feld \d+\/\d+/).first();
    await expect(line).toBeVisible();
    const m = /Feld (\d+)\/(\d+)/.exec((await line.textContent()) ?? "");
    if (!m) throw new Error("Feldnummer nicht lesbar");
    const got = { col: Number(m[1]), row: Number(m[2]) };
    if (got.col === target.col && got.row === target.row) return;
    const g = hexCenterXY(got.col, got.row);
    x += (t.x - g.x) * scale;
    y += (t.y - g.y) * scale;
    await page.locator("main").getByRole("button", { name: "Schließen", exact: true }).click();
  }
  throw new Error(`Feld ${target.col}/${target.row} nicht getroffen`);
}

/** Ratenbegrenzung (Anmeldung, Registrierung) der Test-Instanz zurücksetzen, damit wiederholte Läufe nicht anstoßen. */
export async function resetRateLimits(): Promise<void> {
  const v = new Valkey(E2E.valkeyUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await v.connect();
  const keys = await v.keys("tf:rl:*");
  if (keys.length > 0) await v.del(...keys);
  v.disconnect();
}
