// Datenbankschema (drizzle), thematisch aufgeteilt in ./schema/*. Diese Datei führt alles zusammen; Imports
// (`* as schema`) und drizzle.config.ts lesen weiter nur sie.
export * from "./schema/core.ts";
export * from "./schema/market.ts";
export * from "./schema/social.ts";
export * from "./schema/progress.ts";
export * from "./schema/admin.ts";
export * from "./schema/world.ts";
export * from "./schema/achievements.ts"; // Erfolge und Wochenziele
