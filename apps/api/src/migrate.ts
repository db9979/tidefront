// Migration und Startdaten; läuft einmal vor api und worker.
import { createDb, migrateDb } from "@tidefront/db";
import { seed } from "@tidefront/engine";

const url = process.env.DATABASE_URL ?? "postgres://tidefront:tidefront@localhost:5432/tidefront";
const { db, client } = createDb(url, 1);
await migrateDb(db);
const r = await seed(db, process.env.INVITE_CODES);
console.log(JSON.stringify({ msg: "migrated", ...r }));
await client.end();
