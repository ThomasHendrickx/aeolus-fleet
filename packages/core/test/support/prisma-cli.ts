import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const serverRoot = fileURLToPath(new URL('../..', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** Runs the Prisma CLI from the server package against the given database. */
export function prisma(databaseUrl: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run(process.execPath, [prismaCli, ...args], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
