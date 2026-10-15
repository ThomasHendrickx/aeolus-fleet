/**
 * The publish dry run's check of the console's third-party notices: the
 * tarball ships THIRD_PARTY_NOTICES, it names every package the console
 * ships as found now, and every one of them has a licence to give notice of.
 *
 * Usage, after the console build: node packages/console/scripts/check-third-party-notices.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { NOTICES_FILE, noticedPackages, type NoticedPackage } from './third-party-notices.ts';

const SHIPPED_PATH = `.next/standalone/${NOTICES_FILE}`;

/** What is wrong with the notices the tarball would ship; none when nothing is. */
export function noticesProblems(found: { shipped: readonly string[]; notices: string | undefined; packages: readonly NoticedPackage[] }): string[] {
  const { shipped, notices, packages } = found;
  if (notices === undefined || !shipped.includes(SHIPPED_PATH)) {
    return [`The tarball ships no ${SHIPPED_PATH}: run the console build (scripts/standalone.ts writes it).`];
  }
  const headings = new Set(notices.split('\n'));
  return packages.flatMap((noticed) => {
    const problems: string[] = [];
    if (!headings.has(`${noticed.name} ${noticed.version} (${noticed.license})`)) {
      problems.push(`${NOTICES_FILE} leaves out ${noticed.name} ${noticed.version}: run the console build again.`);
    }
    if (noticed.license === 'not stated' && noticed.licenceTexts.length === 0) {
      problems.push(`${noticed.name} ${noticed.version} states no licence and ships no licence file: find its licence before publishing.`);
    }
    return problems;
  });
}

const packResultSchema = z.array(z.object({ files: z.array(z.object({ path: z.string() })) })).length(1);

if (import.meta.main) {
  const consoleRoot = fileURLToPath(new URL('..', import.meta.url));
  const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const standalone = join(consoleRoot, '.next', 'standalone');
  const packed = execFileSync('npm', ['pack', '--dry-run', '--json', '--workspace', '@aeolus-fleet/console'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const shipped = packResultSchema.parse(JSON.parse(packed)).flatMap((result) => result.files.map((file) => file.path));
  const noticesPath = join(standalone, NOTICES_FILE);
  const problems = noticesProblems({
    shipped,
    notices: existsSync(noticesPath) ? readFileSync(noticesPath, 'utf8') : undefined,
    packages: noticedPackages({ consoleRoot, repositoryRoot, standalone }),
  });
  for (const problem of problems) {
    console.error(problem);
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
