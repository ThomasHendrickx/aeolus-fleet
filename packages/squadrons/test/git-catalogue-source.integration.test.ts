import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGitRepositoryReader } from '../src/adapters/git/git-catalogue-source.js';
import { DEFAULT_PATH } from '../src/core/catalogue/template-repository.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';

// The git reader on real repositories: tags <name>@<n>, lightweight or
// annotated, read at their commits from the .aeolus/squadrons/ folder or the
// repository's path; a new tag shows after a fetch, a repository read without
// fetching gives what it last fetched, within its own fleet only, and a
// failed fetch says why without its token. A token never shows in git's
// command line, where any local process could read it.

const run = promisify(execFile);
let work: string;
let origin: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', origin, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' },
  });
  return stdout.trim();
}

function write(path: string, content: string): void {
  mkdirSync(join(origin, path, '..'), { recursive: true });
  writeFileSync(join(origin, path), content);
}

beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), 'aeolus-git-source-'));
  origin = join(work, 'templates-repo');
  mkdirSync(origin);
  await git('init', '--quiet', '--initial-branch=main');
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function source(path = DEFAULT_PATH) {
  const reader = createGitRepositoryReader({ cacheDir: join(work, 'cache') });
  const repository = { fleetId: FLEET, url: `file://${origin}`, name: 'example.com/templates', path, token: null };
  return {
    files: async () => (await reader.read([repository], { fetch: () => true })).files,
    unfetched: async () => (await reader.read([repository], { fetch: () => false })).files,
    reader,
  };
}

describe('the git repository reader', () => {
  it('reads each tagged template and blueprint at its tag, parsed, with its commit and its time', async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests well.\ncheckIn: 15m\ncharter: You test.\n');
    write('.aeolus/squadrons/blueprints/team.yaml', 'description: A team.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester 2 and team');
    await git('tag', '-a', 'tester@2', '-m', 'tester 2');
    await git('tag', 'team@1');
    const commit = await git('rev-parse', 'HEAD');

    const files = await source().files();

    expect(files.map(({ kind, name, version }) => `${kind} ${name}@${String(version)}`).sort()).toEqual([
      'blueprint team@1',
      'template tester@1',
      'template tester@2',
    ]);
    expect(files.find((file) => file.name === 'tester' && file.version === 2)).toMatchObject({
      repository: 'example.com/templates',
      file: '.aeolus/squadrons/templates/tester.yaml',
      commit,
      content: { description: 'Tests well.', checkIn: '15m', charter: 'You test.' },
    });
  });

  it('ignores tags that are no <name>@<n>, and tags whose commit has no such file', async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'v1.0.0');
    await git('tag', 'planner@1');

    await expect(source().files()).resolves.toEqual([]);
  });

  it('reads nothing from the old squadrons/ folder unless the repository sets it as its path', async () => {
    write('squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');

    await expect(source().files()).resolves.toEqual([]);
  });

  it('reads from the path a repository sets instead of .aeolus/squadrons/', async () => {
    write('ops/fleet/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');

    await expect(source('ops/fleet').files()).resolves.toMatchObject([{ name: 'tester', version: 1, file: 'ops/fleet/templates/tester.yaml' }]);
  });

  it('says why a file is no valid YAML', async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: [unclosed\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');

    const [file] = await source().files();

    expect(typeof file?.parseError).toBe('string');
  });

  it('shows a new tag on the next read: it fetches again', async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    const reading = source();
    await reading.files();
    await git('tag', 'tester@2');

    await expect(reading.files().then((files) => files.length)).resolves.toBe(2);
  });

  it('gives what a repository last fetched when it reads without fetching, and nothing before its first fetch', async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    const reading = source();
    await expect(reading.unfetched()).resolves.toEqual([]);
    await reading.files();
    rmSync(origin, { recursive: true, force: true });

    await expect(reading.unfetched().then((files) => files.map((file) => file.name))).resolves.toEqual(['tester']);
  });

  it('keeps its mirrors in its own aeolus-squadrons folder, which only its user can open, leaving the folder it is given as it was', async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    const shared = join(work, 'shared');
    mkdirSync(shared, { mode: 0o755 });
    chmodSync(shared, 0o755);
    const repository = { fleetId: FLEET, url: `file://${origin}`, name: 'example.com/templates', path: DEFAULT_PATH, token: null };

    await createGitRepositoryReader({ cacheDir: shared }).read([repository], { fetch: () => true });

    expect(statSync(shared).mode & 0o777).toBe(0o755);
    expect(statSync(join(shared, 'aeolus-squadrons')).mode & 0o777).toBe(0o700);
    expect(readdirSync(shared)).toEqual(['aeolus-squadrons']);
  });

  it('gives nothing from a mirror it cannot read, rather than failing the read', async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    const reading = source();
    await reading.files();
    for (const mirror of readdirSync(join(work, 'cache', 'aeolus-squadrons'))) {
      rmSync(join(work, 'cache', 'aeolus-squadrons', mirror, 'HEAD'));
    }

    await expect(reading.unfetched()).resolves.toEqual([]);
  });

  it("never gives another fleet's mirror: the same repository read by a second fleet holds nothing before that fleet fetches it", async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    const reading = source();
    await reading.files();
    const repository = { fleetId: OTHER_FLEET, url: `file://${origin}`, name: 'example.com/templates', path: DEFAULT_PATH, token: 'ghp_wrong' };
    rmSync(origin, { recursive: true, force: true });

    const fetchedByOther = await reading.reader.read([repository], { fetch: () => true });
    const unfetchedByOther = await reading.reader.read([repository], { fetch: () => false });

    expect(fetchedByOther.files).toEqual([]);
    expect(unfetchedByOther.files).toEqual([]);
  });

  it('says why a repository could not be fetched, never with its token, and reads the others', async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    const token = 'ghp_secret_token_value';
    const reader = createGitRepositoryReader({ cacheDir: join(work, 'cache') });

    const { files, fetched } = await reader.read(
      [
        { fleetId: FLEET, url: `file://${join(work, 'missing')}`, name: 'example.com/missing', path: DEFAULT_PATH, token },
        { fleetId: FLEET, url: `file://${origin}`, name: 'example.com/templates', path: DEFAULT_PATH, token: null },
      ],
      { fetch: () => true },
    );

    expect(files.map((file) => file.repository)).toEqual(['example.com/templates']);
    expect(fetched.map((each) => ({ name: each.name, isFailed: each.error !== null }))).toEqual([
      { name: 'example.com/missing', isFailed: true },
      { name: 'example.com/templates', isFailed: false },
    ]);
    const error = fetched[0]?.error ?? '';
    expect(error).not.toContain(token);
    expect(error).not.toContain(Buffer.from(`x-access-token:${token}`).toString('base64'));
  });
});

/**
 * Puts a `git` first on PATH that logs each call's arguments and git
 * environment, then runs `then` (by default the real git) with them.
 */
async function fakeGit(then?: string): Promise<{ log: string; restore: () => void }> {
  const realGit = (await run('sh', ['-c', 'command -v git'])).stdout.trim();
  const bin = join(work, 'bin');
  const log = join(work, 'git.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/sh\nprintf 'argv %s\\n' "$*" >> '${log}'\nenv | grep -E '^GIT_(CONFIG_VALUE|TERMINAL_PROMPT)' >> '${log}'\n${then ?? `exec '${realGit}' "$@"`}\n`,
  );
  chmodSync(join(bin, 'git'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path ?? ''}`;
  return {
    log,
    restore: () => {
      process.env.PATH = path;
    },
  };
}

describe('a private repository', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
  });

  it("hands git its token outside the command line: never in any git process's arguments", async () => {
    write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    const faked = await fakeGit();
    restore = faked.restore;
    const token = 'ghp_secret_token_value';
    const credentials = Buffer.from(`x-access-token:${token}`).toString('base64');
    const reader = createGitRepositoryReader({ cacheDir: join(work, 'cache') });

    const { files } = await reader.read([{ fleetId: FLEET, url: `file://${origin}`, name: 'example.com/templates', path: DEFAULT_PATH, token }], { fetch: () => true });

    expect(files.map((file) => file.name)).toEqual(['tester']);
    const lines = readFileSync(faked.log, 'utf8').split('\n');
    const argv = lines.filter((line) => line.startsWith('argv '));
    expect(argv.length).toBeGreaterThan(0);
    expect(argv.join('\n')).not.toContain(token);
    expect(argv.join('\n')).not.toContain(credentials);
    expect(lines).toContain(`GIT_CONFIG_VALUE_0=Authorization: Basic ${credentials}`);
  });
});

describe('a git that does not answer', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
  });

  it('is stopped after the time allowed, and the read says so, so no later refresh waits on it; git never asks for a password', async () => {
    const faked = await fakeGit('exec sleep 30');
    restore = faked.restore;
    const reader = createGitRepositoryReader({ cacheDir: join(work, 'cache'), timeoutMs: 300 });
    const started = Date.now();

    const { fetched } = await reader.read([{ fleetId: FLEET, url: `file://${origin}`, name: 'example.com/templates', path: DEFAULT_PATH, token: null }], { fetch: () => true });

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(fetched).toEqual([{ name: 'example.com/templates', error: 'git did not answer within 0.3 seconds' }]);
    expect(readFileSync(faked.log, 'utf8').split('\n')).toContain('GIT_TERMINAL_PROMPT=0');
  });
});
