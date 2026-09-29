/**
 * Sets one version on the three published packages and pins their dependencies
 * on each other to exactly that version, because they are released together
 * (ADR 0011). Used by the release workflow and the publish dry run in CI.
 *
 * Usage: npm run set-version -- <version>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLISHED_PACKAGES = ['common', 'server', 'web'] as const;

const SCOPE = '@aeolus-fleet/';
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/;

type Dependencies = Record<string, string>;

interface Manifest {
  name: string;
  version: string;
  dependencies?: Dependencies;
  devDependencies?: Dependencies;
}

export function setVersion(repositoryRoot: string, version: string): void {
  if (!SEMVER.test(version)) {
    throw new Error(`Not a semantic version: "${version}"`);
  }

  for (const name of PUBLISHED_PACKAGES) {
    const path = join(repositoryRoot, 'packages', name, 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;

    manifest.version = version;
    for (const dependencies of [manifest.dependencies, manifest.devDependencies]) {
      for (const dependency of Object.keys(dependencies ?? {})) {
        if (dependencies && dependency.startsWith(SCOPE)) {
          dependencies[dependency] = version;
        }
      }
    }

    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

if (import.meta.main) {
  const version = process.argv[2] ?? '';
  try {
    setVersion(fileURLToPath(new URL('..', import.meta.url)), version);
    console.log(`Set ${PUBLISHED_PACKAGES.map((name) => SCOPE + name).join(', ')} to ${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
