#!/usr/bin/env node
/**
 * `aeolus-squadrons start`: migrates squadrons' database, crews the
 * management ship, then serves until SIGINT or SIGTERM. `aeolus-squadrons
 * migrate`: migrates the database alone.
 */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MigrationError, migrateDatabase } from '../adapters/prisma/migrate.js';
import { createSquadronsApp } from '../app.js';
import { ConfigError, loadConfig, loadDatabaseUrl } from '../config.js';
import { readSquadronsFile } from '../squadrons-file.js';

const USAGE = 'Usage: aeolus-squadrons start | migrate';

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  // Without the file, squadrons runs with no repositories: nothing to form yet.
  const { repositories, refreshMinutes } = readSquadronsFile(
    existsSync(config.squadronsFile) ? readFileSync(config.squadronsFile, 'utf8') : '',
    process.env,
  );
  await migrateDatabase(config.databaseUrl);
  const app = createSquadronsApp({
    databaseUrl: config.databaseUrl,
    fleetUrl: config.fleetUrl,
    managementShip: config.managementShip,
    repositories,
    cacheDir: config.cacheDir ?? join(tmpdir(), 'aeolus-squadrons'),
    logger: { level: config.logLevel },
  });
  const crewed = await app.crewManagementShip();
  if (!crewed.isOk) {
    await app.close();
    throw new ConfigError(crewed.error.message);
  }
  app.server.log.info({ ship: crewed.value.name }, 'crewing the management ship');
  await app.startRefreshing(refreshMinutes * 60_000);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
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
