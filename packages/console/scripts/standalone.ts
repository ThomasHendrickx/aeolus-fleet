/**
 * Completes `.next/standalone` after `next build`, so the package ships it
 * as is: the browser's files go beside the server, which serves them, sharp
 * goes, as the console optimizes no image (next.config.ts) and Next.js
 * traces it regardless, the packages Turbopack links under a hashed name in
 * `.next/node_modules` become copies, as npm pack leaves symbolic links out,
 * and the third-party notices of what remains go in (third-party-notices.ts).
 *
 * Usage: node scripts/standalone.ts
 */
import { cpSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NOTICES_FILE, noticedPackages, noticesText } from './third-party-notices.ts';

const consoleRoot = fileURLToPath(new URL('..', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const standalone = join(consoleRoot, '.next', 'standalone');

cpSync(join(consoleRoot, '.next', 'static'), join(standalone, 'packages', 'console', '.next', 'static'), { recursive: true });
for (const unused of ['sharp', '@img']) {
  rmSync(join(standalone, 'node_modules', unused), { recursive: true, force: true });
}
// Turbopack loads an external package, such as require-in-the-middle for
// telemetry, by a hashed name it links to the package itself.
const hashedExternals = join(standalone, 'packages', 'console', '.next', 'node_modules');
for (const link of readdirSync(hashedExternals, { withFileTypes: true }).filter((entry) => entry.isSymbolicLink())) {
  const path = join(hashedExternals, link.name);
  const linkedPackage = realpathSync(path);
  rmSync(path);
  cpSync(linkedPackage, path, { recursive: true });
}
writeFileSync(join(standalone, NOTICES_FILE), noticesText(noticedPackages({ consoleRoot, repositoryRoot, standalone })));
