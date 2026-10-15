import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { noticedPackages, noticesText } from './third-party-notices.ts';

const MIT_TEXT = 'The MIT License (MIT)\n\nCopyright (c) Vercel, Inc.';

let repositoryRoot: string;

afterEach(() => {
  rmSync(repositoryRoot, { recursive: true, force: true });
});

/** A repository with the console in packages/console, its installed packages, and a standalone output. */
function aRepository(files: Readonly<Record<string, string | object>>) {
  repositoryRoot = mkdtempSync(join(tmpdir(), 'aeolus-notices-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repositoryRoot, path)), { recursive: true });
    writeFileSync(join(repositoryRoot, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  const consoleRoot = join(repositoryRoot, 'packages', 'console');
  return { repositoryRoot, consoleRoot, standalone: join(consoleRoot, '.next', 'standalone') };
}

const names = (packages: readonly { name: string }[]) => packages.map((noticed) => noticed.name);

describe('the third-party notices of the console package', () => {
  it('give notice of what the console bundles and what that depends on, never of its tooling', () => {
    const places = aRepository({
      'packages/console/package.json': { devDependencies: { react: '^19', storybook: '^10', '@types/react': '^19' } },
      'node_modules/react/package.json': { name: 'react', version: '19.3.0', license: 'MIT', dependencies: { scheduler: '^1' } },
      'node_modules/scheduler/package.json': { name: 'scheduler', version: '0.27.0', license: 'MIT' },
      'node_modules/storybook/package.json': { name: 'storybook', version: '10.6.1', license: 'MIT' },
      'node_modules/@types/react/package.json': { name: '@types/react', version: '19.3.0', license: 'MIT' },
    });

    expect(names(noticedPackages(places))).toEqual(['react', 'scheduler']);
  });

  it("give notice of what its own packages depend on, but not of them, which ship under the console's licence", () => {
    const places = aRepository({
      'packages/console/package.json': { devDependencies: { '@aeolus-fleet/common': '0.0.0' } },
      'node_modules/@aeolus-fleet/common/package.json': { name: '@aeolus-fleet/common', version: '0.0.0', license: 'Apache-2.0', dependencies: { zod: '^4' } },
      'node_modules/zod/package.json': { name: 'zod', version: '4.6.5', license: 'MIT' },
    });

    expect(names(noticedPackages(places))).toEqual(['zod']);
  });

  it('give notice of what Next.js traced into the standalone output, vendored packages too, with the licence files it left behind', () => {
    const places = aRepository({
      'packages/console/package.json': { devDependencies: {} },
      'packages/console/.next/standalone/node_modules/next/package.json': { name: 'next', version: '16.3.8', license: 'MIT' },
      'packages/console/.next/standalone/node_modules/next/dist/compiled/cookie/package.json': { name: 'cookie', license: 'MIT' },
      'node_modules/next/package.json': { name: 'next', version: '16.3.8', license: 'MIT' },
      'node_modules/next/license.md': MIT_TEXT,
      'node_modules/next/dist/compiled/cookie/package.json': { name: 'cookie', license: 'MIT' },
      'node_modules/next/dist/compiled/cookie/LICENSE': 'Copyright (c) Roman Shtylman',
    });

    expect(noticedPackages(places)).toEqual([
      { name: 'cookie', version: 'vendored', license: 'MIT', licenceTexts: ['Copyright (c) Roman Shtylman'] },
      { name: 'next', version: '16.3.8', license: 'MIT', licenceTexts: [MIT_TEXT] },
    ]);
  });

  it('give notice of a package once, though it is both traced and bundled', () => {
    const places = aRepository({
      'packages/console/package.json': { devDependencies: { react: '^19' } },
      'packages/console/.next/standalone/node_modules/react/package.json': { name: 'react', version: '19.3.0', license: 'MIT' },
      'node_modules/react/package.json': { name: 'react', version: '19.3.0', license: 'MIT' },
    });

    expect(names(noticedPackages(places))).toEqual(['react']);
  });

  it('name each package with its version and licence, then its licence texts, or say it ships none', () => {
    const text = noticesText([
      { name: 'next', version: '16.3.8', license: 'MIT', licenceTexts: [MIT_TEXT] },
      { name: 'tiny', version: '1.0.0', license: 'ISC', licenceTexts: [] },
    ]);

    expect(text).toContain(`next 16.3.8 (MIT)\n\n${MIT_TEXT}`);
    expect(text).toContain('tiny 1.0.0 (ISC)\n\nThe package ships no licence file; its licence is ISC.');
  });
});
