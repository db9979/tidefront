// Feste Ports und Zugangsdaten des End-to-End-Stacks (eigene Container, unabhängig von einer laufenden Instanz).
const n = (v: string | undefined, d: number) => (v ? Number(v) : d);

const pgPort = n(process.env.E2E_PG_PORT, 55452);
const pgPassword = "e2e";
const valkeyPort = n(process.env.E2E_VALKEY_PORT, 56392);
const webPort = n(process.env.E2E_WEB_PORT, 5380);

export const E2E = {
  pgContainer: "tf-e2e-pg",
  valkeyContainer: "tf-e2e-valkey",
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
