import { migrateDatabase } from './adapters/prisma/migrate.js';
import { startTelemetry } from './adapters/telemetry/telemetry.js';
import { createApp } from './app.js';
import { loadConfig, startupWarnings } from './config.js';

/**
 * `aeolus-core start`: migrates the database, then serves the fleet until
 * SIGINT or SIGTERM. A stop ends waiting receives and closes idle
 * connections at once (see app.ts), then sends the telemetry still buffered.
 * Telemetry starts first, so the server's database client is traced too.
 */
export async function start(): Promise<void> {
  const config = loadConfig(process.env);
  await migrateDatabase(config.databaseUrl);
  const telemetry = await startTelemetry(process.env);
  const server = createApp({
    databaseUrl: config.databaseUrl,
    publicUrl: config.publicUrl,
    logger: { level: config.logLevel },
    shouldTrustProxy: config.shouldTrustProxy,
    cookieDomain: config.cookieDomain,
    consoleOrigin: config.consoleOrigin,
    installationToken: config.installationToken,
    accountTokenIssuer: config.accountTokenIssuer,
  });
  for (const warning of startupWarnings(config)) {
    server.log.warn(warning);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.log.info({ signal }, 'shutting down');
      void server
        .close()
        .then(() => telemetry?.shutdown())
        .then(() => process.exit(0));
    });
  }

  await server.listen({ host: config.host, port: config.port });
}
