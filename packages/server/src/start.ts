import { migrateDatabase } from './adapters/prisma/migrate.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

/**
 * `aeolus-server start`: migrates the database, then serves the fleet until
 * SIGINT or SIGTERM. A stop ends waiting receives and closes idle
 * connections at once (see app.ts).
 */
export async function start(): Promise<void> {
  const config = loadConfig(process.env);
  await migrateDatabase(config.databaseUrl);
  const server = createApp({
    databaseUrl: config.databaseUrl,
    publicUrl: config.publicUrl,
    logger: { level: config.logLevel },
    shouldTrustProxy: config.shouldTrustProxy,
    cookieDomain: config.cookieDomain,
    consoleOrigin: config.consoleOrigin,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.log.info({ signal }, 'shutting down');
      void server.close().then(() => process.exit(0));
    });
  }

  await server.listen({ host: config.host, port: config.port });
}
