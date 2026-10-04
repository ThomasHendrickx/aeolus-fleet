import type { FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGithubRepositoryReader } from '../src/adapters/github/github-repository-reader.js';
import type { RepositoryToRead } from '../src/core/catalogue/ports.js';
import { DEFAULT_PATH } from '../src/core/catalogue/template-repository.js';
import { shaOf, startFakeGithub, type FakeGithub, type FakeTag } from './support/fake-github.js';

// The GitHub reader against a fake GitHub API (S5): tags <name>@<n>, each read
// at its commit from the repository's path, a missing file meaning no such
// version; a private repository read with its own token only; and the files
// of a tag never read again once read at its commit.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const TOKEN = 'ghp_secret_token_value';
const TESTER = 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n';

let github: FakeGithub;

beforeEach(async () => {
  github = await startFakeGithub();
});

afterEach(async () => {
  await github.close();
});

function aTag(name: string, { files = {}, committedAt = new Date('2026-10-01T10:00:00.000Z') }: { files?: Record<string, string>; committedAt?: Date } = {}): FakeTag {
  return { name, sha: shaOf(`${name}-${JSON.stringify(files)}`), committedAt, files };
}

function aRepository(overrides: Partial<RepositoryToRead> = {}): RepositoryToRead {
  return { fleetId: FLEET, name: 'github.com/acme/templates', url: 'https://github.com/acme/templates', path: DEFAULT_PATH, token: null, ...overrides };
}

function reader(timeoutMs?: number) {
  return createGithubRepositoryReader({ apiUrl: github.apiUrl, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
}

const fetchAll = { fetch: () => true };
const fetchNone = { fetch: () => false };

describe('the GitHub repository reader', () => {
  it('reads each tagged template and blueprint at its tag, parsed, with its commit and its time', async () => {
    const tester2 = aTag('tester@2', { files: { '.aeolus/squadrons/templates/tester.yaml': 'description: Tests well.\ncheckIn: 15m\ncharter: You test.\n' }, committedAt: new Date('2026-10-02T10:00:00.000Z') });
    github.repositories.set('acme/templates', {
      tags: [aTag('tester@1', { files: { '.aeolus/squadrons/templates/tester.yaml': TESTER } }), tester2, aTag('team@1', { files: { '.aeolus/squadrons/blueprints/team.yaml': 'description: A team.\n' } })],
    });

    const { files, fetched } = await reader().read([aRepository()], fetchAll);

    expect(fetched).toEqual([{ name: 'github.com/acme/templates', error: null }]);
    expect(files.map(({ kind, name, version }) => `${kind} ${name}@${String(version)}`).sort()).toEqual(['blueprint team@1', 'template tester@1', 'template tester@2']);
    expect(files.find((file) => file.name === 'tester' && file.version === 2)).toEqual({
      repository: 'github.com/acme/templates',
      kind: 'template',
      name: 'tester',
      version: 2,
      file: '.aeolus/squadrons/templates/tester.yaml',
      commit: tester2.sha,
      committedAt: new Date('2026-10-02T10:00:00.000Z'),
      content: { description: 'Tests well.', checkIn: '15m', charter: 'You test.' },
    });
  });

  it('ignores tags that are no <name>@<n>, and tags whose commit has no such file', async () => {
    github.repositories.set('acme/templates', {
      tags: [aTag('v1.0.0', { files: { '.aeolus/squadrons/templates/v1.0.0.yaml': TESTER } }), aTag('planner@1', { files: { '.aeolus/squadrons/templates/tester.yaml': TESTER } }), aTag('tester@0', { files: { '.aeolus/squadrons/templates/tester.yaml': TESTER } })],
    });

    await expect(reader().read([aRepository()], fetchAll).then((read) => read.files)).resolves.toEqual([]);
  });

  it('reads from the path a repository sets instead of .aeolus/squadrons/', async () => {
    github.repositories.set('acme/templates', { tags: [aTag('tester@1', { files: { 'ops/fleet/templates/tester.yaml': TESTER, '.aeolus/squadrons/templates/tester.yaml': TESTER } })] });

    const { files } = await reader().read([aRepository({ path: 'ops/fleet' })], fetchAll);

    expect(files.map((file) => file.file)).toEqual(['ops/fleet/templates/tester.yaml']);
  });

  it('says why a file is no valid YAML', async () => {
    github.repositories.set('acme/templates', { tags: [aTag('tester@1', { files: { '.aeolus/squadrons/templates/tester.yaml': 'description: [unclosed\n' } })] });

    const [file] = (await reader().read([aRepository()], fetchAll)).files;

    expect(typeof file?.parseError).toBe('string');
  });

  it('reads every page of tags', async () => {
    const others = Array.from({ length: 120 }, (_, index) => aTag(`v0.${String(index)}`));
    github.repositories.set('acme/templates', { tags: [...others, aTag('tester@1', { files: { '.aeolus/squadrons/templates/tester.yaml': TESTER } })] });

    const { files } = await reader().read([aRepository()], fetchAll);

    expect(files.map((file) => file.name)).toEqual(['tester']);
  });

  it('says why a repository could not be fetched, and reads the others', async () => {
    github.repositories.set('acme/templates', { tags: [aTag('tester@1', { files: { '.aeolus/squadrons/templates/tester.yaml': TESTER } })] });

    const { files, fetched } = await reader().read([aRepository({ name: 'github.com/acme/missing', url: 'https://github.com/acme/missing' }), aRepository()], fetchAll);

    expect(files.map((file) => file.repository)).toEqual(['github.com/acme/templates']);
    expect(fetched).toEqual([
      { name: 'github.com/acme/missing', error: 'GitHub answered 404 Not Found: no such repository, or a private one its token cannot read' },
      { name: 'github.com/acme/templates', error: null },
    ]);
  });
});

describe('a private repository', () => {
  beforeEach(() => {
    github.repositories.set('acme/templates', { token: TOKEN, tags: [aTag('tester@1', { files: { '.aeolus/squadrons/templates/tester.yaml': TESTER } })] });
  });

  it('is read with its own token, as a bearer token', async () => {
    const { files } = await reader().read([aRepository({ token: TOKEN })], fetchAll);

    expect(files.map((file) => file.name)).toEqual(['tester']);
    expect(github.requests.every((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it.each([
    { label: 'no token', token: null, error: 'GitHub answered 404 Not Found: no such repository, or a private one its token cannot read' },
    { label: 'a wrong token', token: 'ghp_wrong', error: 'GitHub answered 401 Bad credentials: its token cannot read it' },
  ])('is not read with $label, and says why without the token', async ({ token, error }) => {
    const { files, fetched } = await reader().read([aRepository({ token })], fetchAll);

    expect(files).toEqual([]);
    expect(fetched).toEqual([{ name: 'github.com/acme/templates', error }]);
  });

  it("is never served to another fleet from what one fleet read: each fleet's read uses its own token", async () => {
    const reading = reader();
    await reading.read([aRepository({ token: TOKEN })], fetchAll);

    const other = await reading.read([aRepository({ fleetId: OTHER_FLEET })], fetchAll);
    const otherUnfetched = await reading.read([aRepository({ fleetId: OTHER_FLEET })], fetchNone);

    expect(other.files).toEqual([]);
    expect(otherUnfetched.files).toEqual([]);
  });
});

describe('reading again', () => {
  const testerFile = { '.aeolus/squadrons/templates/tester.yaml': TESTER };

  it("never reads a tag's files again once read at its commit, and reads a new tag", async () => {
    github.repositories.set('acme/templates', { tags: [aTag('tester@1', { files: testerFile })] });
    const reading = reader();
    await reading.read([aRepository()], fetchAll);
    github.requests.length = 0;
    const tester2 = aTag('tester@2', { files: { '.aeolus/squadrons/templates/tester.yaml': 'description: Tests well.\ncheckIn: 15m\ncharter: You test.\n' } });
    github.repositories.get('acme/templates')?.tags.push(tester2);

    const { files } = await reading.read([aRepository()], fetchAll);

    expect(files.map((file) => file.version).sort()).toEqual([1, 2]);
    expect(github.requests.filter((request) => !request.path.includes('/tags')).every((request) => request.path.includes(tester2.sha))).toBe(true);
  });

  it('reads a tag again when it points at another commit', async () => {
    github.repositories.set('acme/templates', { tags: [aTag('tester@1', { files: testerFile })] });
    const reading = reader();
    await reading.read([aRepository()], fetchAll);
    const moved = aTag('tester@1', { files: { '.aeolus/squadrons/templates/tester.yaml': 'description: Moved.\ncheckIn: 30m\ncharter: You test.\n' } });
    github.repositories.set('acme/templates', { tags: [moved] });

    const { files } = await reading.read([aRepository()], fetchAll);

    expect(files).toMatchObject([{ commit: moved.sha, content: { description: 'Moved.' } }]);
  });

  it('gives what a repository last fetched when it reads without fetching, nothing before its first fetch, and nothing once forgotten', async () => {
    github.repositories.set('acme/templates', { tags: [aTag('tester@1', { files: testerFile })] });
    const reading = reader();
    await expect(reading.read([aRepository()], fetchNone).then((read) => read.files)).resolves.toEqual([]);
    await reading.read([aRepository()], fetchAll);
    github.requests.length = 0;

    const unfetched = await reading.read([aRepository()], fetchNone);
    await reading.forget(aRepository());
    const forgotten = await reading.read([aRepository()], fetchNone);

    expect(unfetched.files.map((file) => file.name)).toEqual(['tester']);
    expect(github.requests).toEqual([]);
    expect(forgotten.files).toEqual([]);
  });

  it('keeps what a repository last fetched when a fetch fails', async () => {
    github.repositories.set('acme/templates', { tags: [aTag('tester@1', { files: testerFile })] });
    const reading = reader();
    await reading.read([aRepository()], fetchAll);
    github.repositories.delete('acme/templates');

    const { files, fetched } = await reading.read([aRepository()], fetchAll);

    expect(files.map((file) => file.name)).toEqual(['tester']);
    expect(fetched[0]?.error).toMatch(/^GitHub answered 404/);
  });
});

describe('a GitHub that does not answer', () => {
  it('is given up on after the time allowed, and the fetch says so', async () => {
    github.repositories.set('acme/templates', { tags: [] });
    github.delayMs = 2_000;

    const { fetched } = await reader(300).read([aRepository()], fetchAll);

    expect(fetched).toEqual([{ name: 'github.com/acme/templates', error: 'GitHub did not answer within 0.3 seconds' }]);
  });
});
