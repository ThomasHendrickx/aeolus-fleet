/**
 * Sets one version on the four published packages and pins their dependencies
 * on each other to exactly that version, because they are released together
 * (ADR 0011). The aeolus Claude Code plugin carries the same version. Used by the release workflow and the publish dry run in CI.
 *
 * Usage: npm run set-version -- <version>
 *        npm run set-version -- --plugin-only <version>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export const PUBLISHED_PACKAGES = ['common', 'server', 'web', 'squadrons'] as const;

/** The aeolus Claude Code plugin's manifest, released with the packages. */
export const PLUGIN_MANIFEST = 'plugins/aeolus/.claude-plugin/plugin.json';

const SCOPE = '@aeolus-fleet/';
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/;

type Dependencies = Record<string, string>;

const dependenciesSchema = z.record(z.string(), z.string()).optional();

/** The fields set-version changes. */
const manifestSchema = z.object({
  version: z.string(),
  dependencies: dependenciesSchema,
  devDependencies: dependenciesSchema,
});

/** The dependencies, with the published packages pinned to the version. */
function pinned(dependencies: Dependencies | undefined, version: string): Dependencies | undefined {
  return (
    dependencies &&
    Object.fromEntries(
      Object.entries(dependencies).map(([name, range]) => [name, name.startsWith(SCOPE) ? version : range]),
    )
  );
}

export function setVersion(repositoryRoot: string, version: string): void {
  if (!SEMVER.test(version)) {
    throw new Error(`Not a semantic version: "${version}"`);
  }

  for (const name of PUBLISHED_PACKAGES) {
    const path = join(repositoryRoot, 'packages', name, 'package.json');
    // Every field stays where it is; only the version and the pinned dependencies change.
    const manifest = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(path, 'utf8')));
    const { dependencies, devDependencies } = manifestSchema.parse(manifest);
    const updated = {
      ...manifest,
      version,
      dependencies: pinned(dependencies, version),
      devDependencies: pinned(devDependencies, version),
    };

    writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
  }

  setPluginVersion(repositoryRoot, version);
}

/**
 * Sets the version of the aeolus Claude Code plugin alone. The release commits
 * it back to main, where the plugin marketplace installs from, so the
 * installed plugin shows the version just released; the packages on main keep
 * 0.0.0, as only the published packages carry their version.
 */
export function setPluginVersion(repositoryRoot: string, version: string): void {
  if (!SEMVER.test(version)) {
    throw new Error(`Not a semantic version: "${version}"`);
  }
  const pluginPath = join(repositoryRoot, PLUGIN_MANIFEST);
  const plugin = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(pluginPath, 'utf8')));
  writeFileSync(pluginPath, `${JSON.stringify({ ...plugin, version }, null, 2)}\n`);
}

if (import.meta.main) {
  const isPluginOnly = process.argv[2] === '--plugin-only';
  const version = (isPluginOnly ? process.argv[3] : process.argv[2]) ?? '';
  try {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
    if (isPluginOnly) {
      setPluginVersion(repositoryRoot, version);
      console.log(`Set the aeolus plugin to ${version}`);
    } else {
      setVersion(repositoryRoot, version);
      console.log(`Set ${PUBLISHED_PACKAGES.map((name) => SCOPE + name).join(', ')} and the aeolus plugin to ${version}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
