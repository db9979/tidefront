// Datenbankschema (drizzle), thematisch aufgeteilt in ./schema/*. Diese Datei führt alles zusammen; Imports
// (`* as schema`) und drizzle.config.ts lesen weiter nur sie.
export * from "./schema/core.ts";
export * from "./schema/market.ts";
export * from "./schema/social.ts";
export * from "./schema/progress.ts";
export * from "./schema/admin.ts";
export * from "./schema/world.ts";
export * from "./schema/admirals.ts"; // Admirale
export * from "./schema/achievements.ts"; // Erfolge und Wochenziele
export * from "./schema/alliance-ops.ts"; // Allianz-Ops (Sammelangriff, Stationierung)
export * from "./schema/naval.ts"; // See: Minen/Blockade/Konvoi
export * from "./schema/fields.ts"; // Felder: Rohstofffelder
export * from "./schema/intel.ts"; // Lagebild: gespeichertes Wissen
export * from "./schema/power.ts"; // Seekabel / Stromverbund (v1.21)
export * from "./schema/contracts.ts"; // Lieferverträge (v1.31)
