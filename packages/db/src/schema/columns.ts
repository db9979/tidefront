// Gemeinsame Spaltentypen des Schemas.
import { customType, timestamp } from "drizzle-orm/pg-core";

/** Zeitstempel mit Zeitzone als Date. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** Binärdaten (PostgreSQL bytea) als Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
