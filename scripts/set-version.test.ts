import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PUBLISHED_PACKAGES, setVersion } from './set-version.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

// Works on a copy of the real manifests, so the test sees every field the release sees.
let copy: string;

beforeEach(() => {
  copy = mkdtempSync(join(tmpdir(), 'aeolus-set-version-'));
  for (const name of PUBLISHED_PACKAGES) {
    mkdirSync(join(copy, 'packages', name), { recursive: true });
    cpSync(join(repositoryRoot, 'packages', name, 'package.json'), join(copy, 'packages', name, 'package.json'));
  }
});

afterEach(() => {
  rmSync(copy, { recursive: true, force: true });
});

interface Manifest {
  version: string;
  repository: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function manifest(name: string): Manifest {
  return JSON.parse(readFileSync(join(copy, 'packages', name, 'package.json'), 'utf8')) as Manifest;
}

describe('setVersion', () => {
  it('sets the same version on all three packages', () => {
    setVersion(copy, '0.1.0');

    expect(PUBLISHED_PACKAGES.map((name) => manifest(name).version)).toEqual(['0.1.0', '0.1.0', '0.1.0']);
  });

  it('pins the packages to each other at that version', () => {
    setVersion(copy, '0.1.0');

    expect(manifest('server').dependencies?.['@aeolus-fleet/common']).toBe('0.1.0');
    expect(manifest('web').devDependencies?.['@aeolus-fleet/server']).toBe('0.1.0');
  });

  it('leaves other dependencies and the repository field alone', () => {
    const before = manifest('server');

    setVersion(copy, '0.1.0');

    const after = manifest('server');
    expect(after.dependencies?.fastify).toBe(before.dependencies?.fastify);
    expect(after.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/ThomasHendrickx/aeolus-fleet.git',
      directory: 'packages/server',
    });
  });

  it('accepts a prerelease', () => {
    setVersion(copy, '0.0.0-ci.123');

    expect(manifest('common').version).toBe('0.0.0-ci.123');
  });

  it.each(['', 'v0.1.0', '0.1', '01.0.0', '0.1.0 ', 'latest'])('rejects "%s" and changes nothing', (version) => {
    expect(() => {
      setVersion(copy, version);
    }).toThrow(/Not a semantic version/);
    expect(manifest('common').version).toBe('0.0.0');
  });
});

describe('published manifests', () => {
  // npm trusted publishing fails unless repository.url matches exactly (ADR 0011).
  it.each(PUBLISHED_PACKAGES)('%s names this repository and its directory', (name) => {
    const real = JSON.parse(readFileSync(join(repositoryRoot, 'packages', name, 'package.json'), 'utf8')) as Manifest;

    expect(real.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/ThomasHendrickx/aeolus-fleet.git',
      directory: `packages/${name}`,
    });
  });
});
