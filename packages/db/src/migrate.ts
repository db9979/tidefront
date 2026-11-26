import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "./index.ts";

/** Wendet alle Migrationen an. MIGRATIONS_DIR überschreibt den Ordner (im gebündelten Image). */
export async function migrateDb(db: Db, dir = process.env.MIGRATIONS_DIR): Promise<void> {
  const folder = dir ?? fileURLToPath(new URL("../migrations", import.meta.url));
  await migrate(db, { migrationsFolder: folder });
}
