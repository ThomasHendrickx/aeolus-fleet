import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

let repositoryRoot = '';

afterEach(() => {
  rmSync(repositoryRoot, { recursive: true, force: true });
});

describe('the console standalone package', () => {
  it.each([false, true])('completes the package when hashed externals exist: %s', (hasExternals) => {
    repositoryRoot = mkdtempSync(join(process.cwd(), 'standalone-test-'));
    const consoleRoot = join(repositoryRoot, 'packages', 'console');
    const standalone = join(consoleRoot, '.next', 'standalone');
    const externals = join(standalone, 'packages', 'console', '.next', 'node_modules');
    mkdirSync(join(consoleRoot, 'scripts'), { recursive: true });
    mkdirSync(join(consoleRoot, '.next', 'static'), { recursive: true });
    mkdirSync(join(consoleRoot, 'public'), { recursive: true });
    cpSync(join(process.cwd(), 'packages', 'console', 'scripts', 'standalone.ts'), join(consoleRoot, 'scripts', 'standalone.ts'));
    cpSync(join(process.cwd(), 'packages', 'console', 'scripts', 'third-party-notices.ts'), join(consoleRoot, 'scripts', 'third-party-notices.ts'));
    writeFileSync(join(consoleRoot, '.next', 'static', 'asset'), 'asset');
    writeFileSync(join(consoleRoot, 'public', 'public-file'), 'public');
    if (hasExternals) {
      const external = join(repositoryRoot, 'external');
      mkdirSync(external);
      writeFileSync(join(external, 'index.js'), 'external');
      mkdirSync(externals, { recursive: true });
      symlinkSync(external, join(externals, 'hashed'));
    }

    const result = spawnSync(process.execPath, [join(consoleRoot, 'scripts', 'standalone.ts')], { encoding: 'utf8' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(join(standalone, 'packages', 'console', '.next', 'static', 'asset'), 'utf8')).toBe('asset');
    expect(readFileSync(join(standalone, 'packages', 'console', 'public', 'public-file'), 'utf8')).toBe('public');
    expect(existsSync(join(standalone, 'THIRD_PARTY_NOTICES'))).toBe(true);
    if (hasExternals) {
      expect(lstatSync(join(externals, 'hashed')).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(externals, 'hashed', 'index.js'), 'utf8')).toBe('external');
    }
  });
});
