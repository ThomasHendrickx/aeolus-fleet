import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGitCatalogueSource } from '../src/adapters/git/git-catalogue-source.js';

// The git source on real repositories: tags <name>@<n>, lightweight or
// annotated, read at their commits from the squadrons/ folder or a configured
// path; a new tag shows after a refresh.

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

function source(path?: string) {
  return createGitCatalogueSource({
    repositories: [{ url: `file://${origin}`, name: 'example.com/templates', path, token: undefined }],
    cacheDir: join(work, 'cache'),
  });
}

describe('the git catalogue source', () => {
  it('reads each tagged template and blueprint at its tag, parsed, with its commit and its time', async () => {
    write('squadrons/templates/tester.yaml', 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    write('squadrons/templates/tester.yaml', 'description: Tests well.\ncheckIn: 15m\ncharter: You test.\n');
    write('squadrons/blueprints/team.yaml', 'description: A team.\n');
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
      commit,
      content: { description: 'Tests well.', checkIn: '15m', charter: 'You test.' },
    });
  });

  it('ignores tags that are no <name>@<n>, and tags whose commit has no such file', async () => {
    write('squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'v1.0.0');
    await git('tag', 'planner@1');

    await expect(source().files()).resolves.toEqual([]);
  });

  it('reads from the path a repository sets instead of squadrons/', async () => {
    write('ops/fleet/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');

    await expect(source('ops/fleet').files()).resolves.toMatchObject([{ name: 'tester', version: 1 }]);
  });

  it('says why a file is no valid YAML', async () => {
    write('squadrons/templates/tester.yaml', 'description: [unclosed\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');

    const [file] = await source().files();

    expect(file?.parseError).toEqual(expect.any(String));
  });

  it('shows a new tag on the next read: it fetches again', async () => {
    write('squadrons/templates/tester.yaml', 'description: Tests.\n');
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'tester');
    await git('tag', 'tester@1');
    const reading = source();
    await reading.files();
    await git('tag', 'tester@2');

    await expect(reading.files().then((files) => files.length)).resolves.toBe(2);
  });
});
