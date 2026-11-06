/**
 * The publish dry run's check of the console's public files: the tarball
 * ships every file under public/ beside the standalone server, which serves
 * them from there, as next build leaves public/ out of .next/standalone.
 *
 * Usage, after the console build: node packages/console/scripts/check-public-files.ts
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const SHIPPED_PUBLIC = '.next/standalone/packages/console/public';

/** Each file under public/ the tarball leaves out; none when it ships them all. */
export function publicFilesProblems(found: { publicFiles: readonly string[]; shipped: readonly string[] }): string[] {
  const shipped = new Set(found.shipped);
  return found.publicFiles
    .map((file) => `${SHIPPED_PUBLIC}/${file}`)
    .filter((path) => !shipped.has(path))
    .map((path) => `The tarball ships no ${path}: run the console build (scripts/standalone.ts copies public/).`);
}

const packResultSchema = z.array(z.object({ files: z.array(z.object({ path: z.string() })) })).length(1);

if (import.meta.main) {
  const publicRoot = fileURLToPath(new URL('../public', import.meta.url));
  const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const publicFiles = readdirSync(publicRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(publicRoot, join(entry.parentPath, entry.name)).split(sep).join('/'));
  const packed = execFileSync('npm', ['pack', '--dry-run', '--json', '--workspace', '@aeolus-fleet/console'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const shipped = packResultSchema.parse(JSON.parse(packed)).flatMap((result) => result.files.map((file) => file.path));
  const problems = publicFilesProblems({ publicFiles, shipped });
  for (const problem of problems) {
    console.error(problem);
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
