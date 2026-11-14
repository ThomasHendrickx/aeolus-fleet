import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createEmptyDatabase } from '../../src/testing/database.js';

const run = promisify(execFile);
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const MIGRATIONS = fileURLToPath(new URL('../../src/adapters/prisma/migrations', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../src/adapters/prisma/schema.prisma', import.meta.url));

/**
 * Creates a database as an older core left it: `prisma migrate deploy` run
 * with the migrations up to and including `lastMigration` alone, each recorded
 * as applied, as a backup made by that core restores it. Returns its URL.
 */
export async function createDatabaseMigratedUpTo(lastMigration: string): Promise<string> {
  const names = (await readdir(MIGRATIONS)).filter((name) => /^\d{14}_/.test(name)).sort();
  if (!names.includes(lastMigration)) {
    throw new Error(`No migration ${lastMigration}`);
  }
  const databaseUrl = await createEmptyDatabase();
  const folder = await mkdtemp(join(tmpdir(), 'aeolus-older-schema-'));
  try {
    const migrations = join(folder, 'migrations');
    await cp(join(MIGRATIONS, 'migration_lock.toml'), join(migrations, 'migration_lock.toml'));
    for (const name of names.filter((name) => name <= lastMigration)) {
      await cp(join(MIGRATIONS, name), join(migrations, name), { recursive: true });
    }
    const config = join(folder, 'prisma.config.mjs');
    await writeFile(
      config,
      `export default ${JSON.stringify({ schema: SCHEMA, migrations: { path: migrations }, datasource: { url: databaseUrl } })};\n`,
    );
    await run(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', config], {
      cwd: folder,
      env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
  return databaseUrl;
}
