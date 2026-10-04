#!/usr/bin/env node
/**
 * `aeolus-squadrons start`: takes the process lock (one squadrons process per
 * database), migrates squadrons' database, connects again to every fleet with
 * its kept crew token (a fleet without one is not connected until its operator
 * connects squadrons in the console), then serves until SIGINT or SIGTERM. `aeolus-squadrons
 * migrate`: migrates the database alone.
 */
import { MigrationError, migrateDatabase } from '../adapters/prisma/migrate.js';
import { acquireProcessLock } from '../adapters/prisma/process-lock.js';
import { createSquadronsApp } from '../app.js';
import { ConfigError, loadConfig, loadDatabaseUrl } from '../config.js';

const USAGE = 'Usage: aeolus-squadrons start | migrate';

/** How often squadrons looks for squadrons whose flagship does not receive yet, such as after a restart. */
const FLAGSHIP_RESCAN_MS = 30_000;

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  const lock = await acquireProcessLock(config.databaseUrl, {
    onLost: (error) => {
      process.stderr.write(`squadrons lost its process lock, so another process could start: stopping. ${error.message}\n`);
      process.exit(1);
    },
  });
  if (!lock) {
    throw new ConfigError('Another squadrons process runs on this database: squadrons runs one process at a time. Stop the other one first.');
  }
  await migrateDatabase(config.databaseUrl);
  const app = createSquadronsApp({
    databaseUrl: config.databaseUrl,
    fleetUrl: config.fleetUrl,
    logger: { level: config.logLevel },
    ...(config.installationToken === undefined ? {} : { installationToken: config.installationToken }),
  });
  // Every fleet squadrons was connected to, connected again with its kept crew token.
  const restored = await app.restoreConnections();
  for (const { fleetId, ship, recovered, retired } of restored) {
    app.server.log.info({ fleet: fleetId, ship }, 'connected as the management ship');
    if (recovered > 0) {
      app.server.log.warn({ fleet: fleetId, recovered, retired }, 'retired what formations a crash left unfinished had commissioned');
    }
  }
  if (restored.length === 0) {
    app.server.log.warn('connected to no fleet: an operator connects squadrons in the console (Settings, Connect squadrons)');
  }
  // The template repositories the operator set, each fetched once: squadrons keeps nothing of them across a restart.
  await app.refreshCatalogue();
  app.startFlagships(FLAGSHIP_RESCAN_MS);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app
        .close()
        .then(() => lock.release())
        .then(() => process.exit(0));
    });
  }
  await app.server.listen({ host: config.host, port: config.port });
}

try {
  switch (process.argv[2] ?? '') {
    case 'start':
      await start();
      break;
    case 'migrate':
      await migrateDatabase(loadDatabaseUrl(process.env));
      break;
    default:
      process.stderr.write(`${USAGE}\n`);
      process.exitCode = 2;
  }
} catch (error) {
  if (error instanceof ConfigError || error instanceof MigrationError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
