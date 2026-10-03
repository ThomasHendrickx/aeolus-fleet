#!/usr/bin/env node
/**
 * `aeolus-squadrons start`: takes the process lock (one squadrons process per
 * database), migrates squadrons' database, connects again with the kept crew
 * token if it has one (otherwise it serves not connected, until the operator
 * connects it in the console), then serves until SIGINT or SIGTERM. `aeolus-squadrons
 * migrate`: migrates the database alone.
 */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MigrationError, migrateDatabase } from '../adapters/prisma/migrate.js';
import { acquireProcessLock } from '../adapters/prisma/process-lock.js';
import { createSquadronsApp } from '../app.js';
import { ConfigError, loadConfig, loadDatabaseUrl } from '../config.js';
import { readSquadronsFile } from '../squadrons-file.js';

const USAGE = 'Usage: aeolus-squadrons start | migrate';

/** How often squadrons looks for squadrons whose flagship does not receive yet, such as after a restart. */
const FLAGSHIP_RESCAN_MS = 30_000;

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  // Without the file, squadrons runs with no repositories: nothing to form yet.
  const { repositories, refreshMinutes } = readSquadronsFile(
    existsSync(config.squadronsFile) ? readFileSync(config.squadronsFile, 'utf8') : '',
    process.env,
  );
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
    repositories,
    cacheDir: config.cacheDir ?? join(tmpdir(), 'aeolus-squadrons'),
    logger: { level: config.logLevel },
  });
  const connection = await app.readConnection();
  if (connection.state === 'connected') {
    app.server.log.info({ ship: connection.ship?.name }, 'connected as the management ship');
    const recovered = await app.recoverFormations();
    if (recovered.isOk && recovered.value.recovered > 0) {
      app.server.log.warn(recovered.value, 'retired what formations a crash left unfinished had commissioned');
    }
  } else {
    app.server.log.warn('not connected: connect squadrons in the console (Settings, Connect squadrons)');
  }
  await app.startRefreshing(refreshMinutes * 60_000);
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
