// Version der laufenden Server-Fassung (aus package.json) und Zeitpunkt des Builds (beim Bündeln gesetzt).
import pkg from "../../../package.json" with { type: "json" };

export const APP_VERSION: string = pkg.version;
export const BUILD_TIME: string | null = process.env.TF_BUILD_TIME ?? null;
