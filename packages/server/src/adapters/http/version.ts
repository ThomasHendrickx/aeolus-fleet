import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { z } from 'zod';

const packageJson = z.object({ version: z.string() });

/** The version in a package.json, read from disk: what this process runs, not what a deploy meant to ship. */
function versionAt(file: URL | string): string {
  return packageJson.parse(JSON.parse(readFileSync(file, 'utf8'))).version;
}

/**
 * The versions this server process runs: its own package's, and that of the
 * @aeolus-fleet/common it loaded, which a deploy that failed halfway may
 * leave different. Read once, when the server starts.
 */
export function runningVersions(): { server: string; common: string } {
  // This file sits at src/adapters/http, or dist/adapters/http once built:
  // the package root is three levels up either way.
  const server = versionAt(new URL('../../../package.json', import.meta.url));
  const commonEntry = createRequire(import.meta.url).resolve('@aeolus-fleet/common');
  // Common's entry is src/index.ts or dist/index.js: its package.json is one level up.
  const common = versionAt(new URL('../package.json', `file://${commonEntry}`));
  return { server, common };
}
