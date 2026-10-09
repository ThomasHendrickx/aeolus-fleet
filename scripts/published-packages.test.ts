import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PUBLISHED_PACKAGES } from './set-version.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

const packResultSchema = z.array(z.object({ files: z.array(z.object({ path: z.string() })) })).length(1);

/** The paths npm would put in the package's tarball. */
function tarballFiles(name: string): string[] {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--workspace', `@aeolus-fleet/${name}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [result] = packResultSchema.parse(JSON.parse(output));
  return result?.files.map((file) => file.path) ?? [];
}

describe.each(PUBLISHED_PACKAGES)('the published package %s', (name) => {
  it('ships the LICENSE', { timeout: 30_000 }, () => {
    expect(tarballFiles(name)).toContain('LICENSE');
  });
});

describe('the published package console', () => {
  /** Writes stand-ins for files next build writes into .next/standalone, so the test needs no build. */
  function withStandIns(paths: readonly string[], check: () => void): void {
    const standalone = join(repositoryRoot, 'packages', 'console', '.next', 'standalone');
    const wasBuilt = existsSync(standalone);
    for (const path of paths) {
      mkdirSync(dirname(join(standalone, path)), { recursive: true });
      writeFileSync(join(standalone, path), '{}');
    }
    try {
      check();
    } finally {
      if (wasBuilt) {
        for (const path of paths) {
          rmSync(join(standalone, path), { force: true });
        }
      } else {
        rmSync(standalone, { recursive: true, force: true });
      }
    }
  }

  it('ships the standalone server with the modules it traced', { timeout: 30_000 }, () => {
    withStandIns(['packages/console/server.js', 'node_modules/aeolus-published-packages-test/index.js'], () => {
      expect(tarballFiles('console')).toEqual(
        expect.arrayContaining(['.next/standalone/packages/console/server.js', '.next/standalone/node_modules/aeolus-published-packages-test/index.js']),
      );
    });
  });

  it('ships no source maps of the server build', { timeout: 30_000 }, () => {
    withStandIns(['packages/console/.next/server/aeolus-published-packages-test.js.map'], () => {
      expect(tarballFiles('console').filter((path) => path.endsWith('.map'))).toEqual([]);
    });
  });

  it('installs no dependency: the standalone output holds what it runs', () => {
    const manifest = z.object({ dependencies: z.record(z.string(), z.string()).optional() }).parse(JSON.parse(readFileSync(join(repositoryRoot, 'packages', 'console', 'package.json'), 'utf8')));
    expect(manifest.dependencies).toBeUndefined();
  });
});
