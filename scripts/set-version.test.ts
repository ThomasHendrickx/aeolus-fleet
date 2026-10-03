import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PLUGIN_MANIFEST, PUBLISHED_PACKAGES, setPluginVersion, setVersion } from './set-version.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

// Works on a copy of the real manifests, so the test sees every field the release sees.
let copy: string;

beforeEach(() => {
  copy = mkdtempSync(join(tmpdir(), 'aeolus-set-version-'));
  for (const name of PUBLISHED_PACKAGES) {
    mkdirSync(join(copy, 'packages', name), { recursive: true });
    cpSync(join(repositoryRoot, 'packages', name, 'package.json'), join(copy, 'packages', name, 'package.json'));
  }
  mkdirSync(join(copy, PLUGIN_MANIFEST, '..'), { recursive: true });
  cpSync(join(repositoryRoot, PLUGIN_MANIFEST), join(copy, PLUGIN_MANIFEST));
});

afterEach(() => {
  rmSync(copy, { recursive: true, force: true });
});

const dependencies = z.record(z.string(), z.string()).optional();
const manifestSchema = z.object({
  version: z.string(),
  repository: z.unknown(),
  dependencies,
  devDependencies: dependencies,
});

function manifest(name: string): z.infer<typeof manifestSchema> {
  return manifestSchema.parse(JSON.parse(readFileSync(join(copy, 'packages', name, 'package.json'), 'utf8')));
}

describe('setVersion', () => {
  it('sets the same version on the aeolus Claude Code plugin, keeping its other fields', () => {
    const before = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(join(copy, PLUGIN_MANIFEST), 'utf8')));

    setVersion(copy, '0.3.0');

    expect(JSON.parse(readFileSync(join(copy, PLUGIN_MANIFEST), 'utf8'))).toEqual({ ...before, version: '0.3.0' });
  });

  it('sets the same version on all four packages, squadrons included', () => {
    setVersion(copy, '0.1.0');

    expect(PUBLISHED_PACKAGES).toEqual(['common', 'server', 'web', 'squadrons']);
    expect(PUBLISHED_PACKAGES.map((name) => manifest(name).version)).toEqual(['0.1.0', '0.1.0', '0.1.0', '0.1.0']);
  });

  it('pins squadrons to common and the server at that version', () => {
    setVersion(copy, '0.1.0');

    expect(manifest('squadrons').dependencies?.['@aeolus-fleet/common']).toBe('0.1.0');
    expect(manifest('squadrons').devDependencies?.['@aeolus-fleet/server']).toBe('0.1.0');
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

  it('keeps every field of the manifest in its place', () => {
    const keys = () => Object.keys(z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(path, 'utf8'))));
    const path = join(copy, 'packages', 'server', 'package.json');
    const before = keys();

    setVersion(copy, '0.1.0');

    expect(keys()).toEqual(before);
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
    const real = manifestSchema.parse(JSON.parse(readFileSync(join(repositoryRoot, 'packages', name, 'package.json'), 'utf8')));

    expect(real.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/ThomasHendrickx/aeolus-fleet.git',
      directory: `packages/${name}`,
    });
  });
});

describe('setPluginVersion', () => {
  it("sets the aeolus plugin's version alone, leaving the packages as they are", () => {
    const packagesBefore = PUBLISHED_PACKAGES.map((name) => manifest(name));

    setPluginVersion(copy, '0.4.0');

    expect(JSON.parse(readFileSync(join(copy, PLUGIN_MANIFEST), 'utf8'))).toMatchObject({ name: 'aeolus', version: '0.4.0' });
    expect(PUBLISHED_PACKAGES.map((name) => manifest(name))).toEqual(packagesBefore);
  });

  it('refuses a version that is not semantic', () => {
    expect(() => {
      setPluginVersion(copy, 'latest');
    }).toThrow('Not a semantic version: "latest"');
  });
});
