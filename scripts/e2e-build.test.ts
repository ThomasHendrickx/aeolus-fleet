import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The console is built once per CI run, by one npm script that the workflow
// and the README both name; no end-to-end file builds it again.

const read = (path: string): string => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

describe('the build the end-to-end tests run against', () => {
  it('is one npm script, build:e2e, that builds common, ui and the console', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

    expect(scripts['build:e2e']).toBe('npm run build --workspace @aeolus-fleet/common --workspace @aeolus-fleet/ui --workspace @aeolus-fleet/console');
  });

  it('is the one the CI e2e job and the README name', () => {
    expect(read('.github/workflows/ci.yml')).toContain('run: npm run build:e2e');
    expect(read('README.md')).toContain('npm run build:e2e');
  });

  it('is not made again by the install end-to-end test, which builds only core', () => {
    const install = read('e2e/install.e2e.test.ts');

    expect(install).not.toContain("'npm', ['run', 'build']");
    expect(install).toContain("['run', 'build', '--workspace', '@aeolus-fleet/core']");
  });
});
