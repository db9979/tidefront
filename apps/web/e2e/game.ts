// Spielzustand in der Test-DB herstellen und Spielzeit verkürzen, statt minutenlang zu warten.
// Der Worker (Abfrage alle 250 ms) arbeitet die vorgezogenen Ereignisse danach regulär ab.
import type postgres from "postgres";
import { hexSteps } from "@tidefront/game-core";
import { COLS, ROWS, hexDistanceKm, hexIndex, nearestTradePort, terrainMap } from "@tidefront/world";
import { awayFromEdge, until } from "./fixtures.ts";

type Sql = ReturnType<typeof postgres>;
// Hafenzustand und Missionsplan als freies JSON (die Tests setzen nur einzelne Felder).
type State = Record<string, any>;

/** Hafenzustand (JSON) unter Zeilensperre ändern. */
export async function updateState(sql: Sql, baseId: number, fn: (s: State) => void): Promise<State> {
  return sql.begin(async (tx) => {
    const [row] = await tx`select state from base where id = ${baseId} for update`;
    const s = row.state as State;
    fn(s);
    await tx`update base set state = ${JSON.stringify(s)}::jsonb where id = ${baseId}`;
    return s;
  });
}

export async function readState(sql: Sql, baseId: number): Promise<State> {
  const [row] = await sql`select state from base where id = ${baseId}`;
  return row.state as State;
}

/** Bestände setzen (Lager wird bei Bedarf über den Lagerkomplex mitgezogen). */
export async function setResources(sql: Sql, baseId: number, res: Record<string, number>): Promise<void> {
  await updateState(sql, baseId, (s) => {
    s.resources = { ...s.resources, ...res };
    s.resUpdatedAt = Date.now();
  });
}

export async function setBuildings(sql: Sql, baseId: number, levels: Record<string, number>): Promise<void> {
  await updateState(sql, baseId, (s) => { s.buildings = { ...s.buildings, ...levels }; });
}

export async function setUnits(sql: Sql, baseId: number, units: Record<string, number>): Promise<void> {
  await updateState(sql, baseId, (s) => { s.units = { ...s.units, ...units }; });
}

/**
 * Laufende Bau- bzw. Ausbildungsaufträge sofort fällig machen: Zeiten in der Schlange um den Rest
 * vorziehen und die zugehörigen Ereignisse auf jetzt legen.
 */
async function fastForwardQueue(sql: Sql, baseId: number, queue: "buildQueue" | "trainingQueue", eventType: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [row] = await tx`select state from base where id = ${baseId} for update`;
    const s = row.state as State;
    const q = (s[queue] ?? []) as { startedAt: number; finishesAt: number }[];
    if (q.length === 0) return;
    const now = Date.now();
    const delta = Math.max(...q.map((o) => o.finishesAt)) - now + 200;
    if (delta <= 0) return;
    for (const o of q) { o.startedAt -= delta; o.finishesAt -= delta; }
    await tx`update base set state = ${JSON.stringify(s)}::jsonb where id = ${baseId}`;
    await tx`update game_event set due_at = due_at - ${delta} * interval '1 millisecond'
             where base_id = ${baseId} and type = ${eventType} and status = 'pending'`;
  });
}

export async function finishBuilds(sql: Sql, baseId: number): Promise<void> {
  await fastForwardQueue(sql, baseId, "buildQueue", "build_complete");
  await until(async () => ((await readState(sql, baseId)).buildQueue ?? []).length === 0, "Bauschlange abgearbeitet");
}

export async function finishTraining(sql: Sql, baseId: number): Promise<void> {
  await fastForwardQueue(sql, baseId, "trainingQueue", "training_complete");
  await until(async () => ((await readState(sql, baseId)).trainingQueue ?? []).length === 0, "Ausbildung abgeschlossen");
}

/**
 * Mission vorspulen: alle Zeiten (Plan, Ankunft, Rückkehr, Ereignisse) um die Restzeit bis zum nächsten
 * Schritt vorziehen. Liefert den neuen Status, nachdem der Worker das Ereignis verarbeitet hat.
 */
export async function fastForwardMission(sql: Sql, missionId: number): Promise<string> {
  const [m] = await sql`select status, (extract(epoch from arrive_at) * 1000)::float8 as arrive_ms,
                                (extract(epoch from return_at) * 1000)::float8 as return_ms from mission where id = ${missionId}`;
  const target = (m.status === "outbound" ? m.arrive_ms : m.status === "returning" ? m.return_ms : null) as number | null;
  if (target === null) return m.status as string;
  const delta = Math.round(target - Date.now() + 200);
  if (delta > 0) {
    await sql.begin(async (tx) => {
      const [row] = await tx`select plan from mission where id = ${missionId} for update`;
      const plan = row.plan as State;
      for (const k of ["departAtMs", "arriveAtMs", "returnAtMs", "holdUntilMs"]) if (typeof plan[k] === "number") plan[k] -= delta;
      await tx`update mission set plan = ${JSON.stringify(plan)}::jsonb,
                 arrive_at = arrive_at - ${delta} * interval '1 millisecond',
                 return_at = return_at - ${delta} * interval '1 millisecond'
               where id = ${missionId}`;
      await tx`update game_event set due_at = due_at - ${delta} * interval '1 millisecond'
               where status = 'pending' and (payload->>'missionId')::int = ${missionId}`;
    });
  }
  const before = m.status as string;
  return until(async () => {
    const [r] = await sql`select status from mission where id = ${missionId}`;
    return r.status !== before ? (r.status as string) : null;
  }, `Mission ${missionId} nach ${before}`);
}

/**
 * Freies Küstenfeld für eine Gründung: 3–7 Feldschritte vom eigenen Hafen (nah genug, um es auf der Karte
 * anzutippen), mindestens 4 Schritte zu fremden Häfen, kein Nest, Feld oder Handelshafen, nicht am Kartenrand.
 */
export async function foundingSpot(sql: Sql, home: { col: number; row: number }, maxKm = Infinity): Promise<{ col: number; row: number }> {
  const bases = await sql`select col, row from base`;
  const blocked = new Set<string>();
  for (const r of await sql`select col, row from nest union all select col, row from resource_field`) blocked.add(`${r.col},${r.row}`);
  const t = terrainMap();
  const out: { col: number; row: number; s: number }[] = [];
  for (let row = Math.max(0, home.row - 10); row <= Math.min(ROWS - 1, home.row + 10); row++) {
    for (let col = Math.max(0, home.col - 10); col <= Math.min(COLS - 1, home.col + 10); col++) {
      const h = { col, row };
      if (t[hexIndex(col, row)] !== "coast" || blocked.has(`${col},${row}`)) continue;
      const s = hexSteps(home, h);
      if (s < 3 || s > 7 || !awayFromEdge(h) || hexDistanceKm(home, h) > maxKm) continue;
      if (nearestTradePort(h).distanceKm < 1) continue;
      if (bases.some((b) => !(b.col === home.col && b.row === home.row) && hexSteps({ col: b.col as number, row: b.row as number }, h) < 4)) continue;
      out.push({ col, row, s: s * 100 + Math.abs(row - home.row) });
    }
  }
  if (out.length === 0) throw new Error("kein Gründungsfeld in der Nähe");
  out.sort((a, b) => a.s - b.s);
  return { col: out[0].col, row: out[0].row };
}

/**
 * Freies Rohstofffeld der Stufe 1 nahe `near` atomar für diesen Test reservieren (TE-03): Auswahl und Reservierung in
 * einer Transaktion unter pg_advisory_xact_lock, damit parallele Specs (Felder, Admiral, Geleit) nie dasselbe Feld
 * nehmen. Die Reservierung ist eine Missionszeile ohne Spieler und ohne Ereignis (Status e2e-reserviert).
 */
export async function reserveField(sql: Sql, near: { col: number; row: number }): Promise<{ id: number; col: number; row: number }> {
  const picked = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('e2e-field-reserve'))`;
    const rows = await tx`select id, col, row from resource_field where tier = 1 and player_id is null and not exists (select 1 from mission m where m.target_col = resource_field.col and m.target_row = resource_field.row and m.status in ('outbound', 'holding', 'returning', 'e2e-reserviert'))`;
    const field = rows
      .map((f) => ({ id: f.id as number, col: f.col as number, row: f.row as number }))
      .filter(awayFromEdge)
      .map((f) => ({ ...f, d: hexDistanceKm(near, f) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!field) throw new Error("kein freies Rohstofffeld für den Test");
    await tx`insert into mission (player_id, base_id, type, target_kind, target_col, target_row, plan, status, arrive_at) values (null, null, 'e2e', 'field', ${field.col}, ${field.row}, '{}'::jsonb, 'e2e-reserviert', now() + interval '1 day')`;
    return { id: field.id, col: field.col, row: field.row };
  });
  return picked as { id: number; col: number; row: number };
}
