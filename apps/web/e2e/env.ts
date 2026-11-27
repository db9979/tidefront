// Feste Ports und Zugangsdaten des End-to-End-Stacks (eigene Container, unabhängig von einer laufenden Instanz).
// E2E_SLOT (0, 1, 2 …) trennt parallele Läufe (z. B. mehrere Agenten): eigene Containernamen, alle Ports um 10 je Slot
// versetzt. Einzelne Ports lassen sich weiter mit E2E_*_PORT setzen.
const slot = Math.max(0, Math.floor(Number(process.env.E2E_SLOT ?? 0) || 0));
const n = (v: string | undefined, d: number) => (v ? Number(v) : d + slot * 10);

const pgPort = n(process.env.E2E_PG_PORT, 55452);
const pgPassword = "e2e";
const valkeyPort = n(process.env.E2E_VALKEY_PORT, 56392);
const webPort = n(process.env.E2E_WEB_PORT, 5380);

export const E2E = {
  // E2E_PG_CONTAINER / E2E_VALKEY_CONTAINER überschreiben die Namen; sonst je Slot eigene.
  pgContainer: process.env.E2E_PG_CONTAINER ?? (slot ? `tf-e2e-pg-${slot}` : "tf-e2e-pg"),
  valkeyContainer: process.env.E2E_VALKEY_CONTAINER ?? (slot ? `tf-e2e-valkey-${slot}` : "tf-e2e-valkey"),
  pgPort,
  pgPassword,
  valkeyPort,
  apiPort: n(process.env.E2E_API_PORT, 18380),
  workerPort: n(process.env.E2E_WORKER_PORT, 18381),
  webPort,
  databaseUrl: `postgres://tidefront:${pgPassword}@127.0.0.1:${pgPort}/tidefront`,
  valkeyUrl: `redis://127.0.0.1:${valkeyPort}`,
  webUrl: `http://127.0.0.1:${webPort}`,
  /** Einladungscode der Test-Datenbank (500 Anmeldungen). */
  invite: "E2ETEST",
  /** Wird über ADMIN_NAMES zum Admin. */
  adminName: "Admiral E2E",
};
