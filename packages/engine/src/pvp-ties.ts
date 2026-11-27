// PvP-Absprache (docs/VORLAGE-PVP.md): beendete Verbindungen zwischen Spielern – Allianz verlassen, ausgeschlossen
// oder aufgelöst, Pakt erloschen – für collusionDays merken (server_setting pvp_ties: Paar → Zeitpunkt). Eigene Datei
// ohne weitere Engine-Abhängigkeiten, damit alliance.ts und alliance-core.ts sie ohne Kreisimport nutzen.
import { sql } from "drizzle-orm";
import { pvpOf } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";

const DAY_MS = 86400000;
export const TIES_KEY = "pvp_ties";

/** Jedes Paar aus a × b (ohne a = b) mit Zeitpunkt atMs; ältere Einträge als collusionDays fallen in derselben Anweisung weg. */
export async function recordTies(db: DbOrTx, a: number[], b: number[], atMs: number): Promise<void> {
  const cfg = pvpOf(balance);
  if (!cfg) return;
  const add: Record<string, number> = {};
  for (const x of a) for (const y of b) if (x !== y) add[x < y ? `${x}:${y}` : `${y}:${x}`] = atMs;
  if (Object.keys(add).length === 0) return;
  const cutoff = atMs - cfg.collusionDays * DAY_MS;
  await db.execute(sql`
    insert into server_setting (key, value) values (${TIES_KEY}, ${JSON.stringify(add)})
    on conflict (key) do update set updated_at = now(), value = (
      select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)::text
      from jsonb_each(server_setting.value::jsonb || excluded.value::jsonb) as e(k, v)
      where (e.v #>> '{}')::bigint > ${cutoff}
    )`);
}
