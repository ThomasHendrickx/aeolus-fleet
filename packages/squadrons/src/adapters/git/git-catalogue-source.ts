/**
 * Templates and blueprints from git (docs/squadrons.md, "Files in git"), with
 * the git command line. Each fleet's repository is kept as its own bare
 * mirror, so one fleet never reads what another fetched, in an
 * aeolus-squadrons folder within the cache folder that opens to squadrons'
 * own user only; the cache folder itself is left as it is.
 * Fetching brings a mirror up to date with its tags, and a mirror git cannot
 * read right after counts as a failed fetch; a repository read without
 * fetching gives what its mirror holds, and nothing before its first fetch,
 * after it is forgotten, or when git cannot read its mirror. A version is a tag `<name>@<n>`;
 * its file is `<path>/templates/<name>.yaml` or
 * `<path>/blueprints/<name>.yaml` at the tag's commit. A token, for a private
 * repository, travels as basic authentication on the fetch only, handed to
 * git in its environment (which only the same user can read), never in its
 * command line; and it never appears in what a failed fetch says. Every git
 * call is stopped after the time allowed, and git never asks for a password,
 * so no refresh waits on a git that does not answer.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { parse, YAMLParseError } from 'yaml';

import type { RepositoryReader, RepositoryToRead, SourceFile } from '../../core/catalogue/ports.js';

const run = promisify(execFile);

const VERSION_TAG = /^([a-z0-9:-]+)@([1-9]\d*)$/;
const KINDS = [
  { kind: 'template', folder: 'templates' },
  { kind: 'blueprint', folder: 'blueprints' },
] as const;

/** The longest account of a failed fetch squadrons keeps. */
const FETCH_ERROR_MAX_LENGTH = 300;

/** squadrons' own folder within the cache folder it is given, holding the mirrors. */
const MIRRORS_FOLDER = 'aeolus-squadrons';

/** How long one git call may take before it is stopped. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Runs git with its arguments, a token's header in its environment when given, and answers what it wrote to standard output. */
type Git = (args: string[], token?: string | null) => Promise<string>;

/** The basic authentication a token travels as: GitHub takes a token as the password of any user, x-access-token the name it documents. */
function basicCredentials(token: string): string {
  return Buffer.from(`x-access-token:${token}`).toString('base64');
}

/**
 * git's environment: never a prompt for a password, and a token's header as
 * configuration set through the environment, so no command line holds it.
 */
function environment(token: string | null): NodeJS.ProcessEnv {
  if (token === null) {
    return { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  }
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicCredentials(token)}`,
  };
}

/**
 * What a failed fetch says: the last line git wrote to standard error, never
 * the command, with the token and its
 * credentials blanked should git ever repeat them.
 */
function fetchErrorOf(error: unknown, { token, timeoutMs }: { token: string | null; timeoutMs: number }): string {
  if (typeof error === 'object' && error !== null && 'killed' in error && error.killed === true) {
    return `git did not answer within ${String(timeoutMs / 1000)} seconds`;
  }
  const stderr = typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  const line = stderr.split('\n').map((each) => each.trim()).filter((each) => each !== '').at(-1) ?? 'git could not fetch the repository';
  const said = line.replace(/^fatal: /, '');
  const blanked = token === null ? said : said.split(token).join('***').split(basicCredentials(token)).join('***');
  return blanked.slice(0, FETCH_ERROR_MAX_LENGTH);
}

function gitWithin(timeoutMs: number): Git {
  return async (args, token = null) => {
    const { stdout } = await run('git', args, { env: environment(token), timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  };
}

function mirrorOf(repository: Pick<RepositoryToRead, 'fleetId' | 'url'>, cacheDir: string): string {
  return join(cacheDir, MIRRORS_FOLDER, createHash('sha256').update(`${repository.fleetId} ${repository.url}`).digest('hex').slice(0, 16));
}

/** Brings the repository's mirror up to date with its tags, cloning it the first time. */
async function fetchMirror(git: Git, { repository, cacheDir }: { repository: RepositoryToRead; cacheDir: string }): Promise<void> {
  const mirror = mirrorOf(repository, cacheDir);
  const mirrors = join(cacheDir, MIRRORS_FOLDER);
  mkdirSync(mirrors, { recursive: true, mode: 0o700 });
  chmodSync(mirrors, 0o700);
  if (!existsSync(mirror)) {
    await git(['clone', '--bare', '--quiet', repository.url, mirror], repository.token);
  }
  await git(['-C', mirror, 'fetch', '--quiet', '--prune', 'origin', '+refs/tags/*:refs/tags/*'], repository.token);
}

/** Every tag with the commit it points at (an annotated tag peeled) and that commit's time. */
async function tags(git: Git, mirror: string): Promise<{ tag: string; commit: string; committedAt: Date }[]> {
  const output = await git([
    '-C',
    mirror,
    'for-each-ref',
    '--format=%(refname:short)%09%(if)%(*objectname)%(then)%(*objectname)%09%(*committerdate:iso-strict)%(else)%(objectname)%09%(committerdate:iso-strict)%(end)',
    'refs/tags',
  ]);
  return output
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [tag = '', commit = '', committedAt = ''] = line.split('\t');
      return { tag, commit, committedAt: new Date(committedAt) };
    });
}

/** The file at the commit; undefined when the commit has no such file. */
async function fileAt(git: Git, { mirror, commit, path }: { mirror: string; commit: string; path: string }): Promise<string | undefined> {
  try {
    return await git(['-C', mirror, 'show', `${commit}:${path}`]);
  } catch {
    return undefined;
  }
}

function parsed(text: string): { content: unknown; parseError?: string } {
  try {
    return { content: parse(text) };
  } catch (error) {
    if (error instanceof YAMLParseError) {
      return { content: undefined, parseError: error.message };
    }
    throw error;
  }
}

/** Every tagged template and blueprint version in a repository's mirror; none, and why, when git cannot read the mirror. */
async function filesIn(git: Git, { repository, mirror }: { repository: RepositoryToRead; mirror: string }): Promise<{ files: SourceFile[]; failure?: unknown }> {
  let tagged: Awaited<ReturnType<typeof tags>>;
  try {
    tagged = await tags(git, mirror);
  } catch (error) {
    return { files: [], failure: error };
  }
  const files: SourceFile[] = [];
  for (const { tag, commit, committedAt } of tagged) {
    const version = VERSION_TAG.exec(tag);
    if (!version) {
      continue;
    }
    const [, name = '', number = ''] = version;
    for (const { kind, folder } of KINDS) {
      const file = `${repository.path}/${folder}/${name}.yaml`;
      const text = await fileAt(git, { mirror, commit, path: file });
      if (text !== undefined) {
        files.push({ repository: repository.name, kind, name, version: Number(number), file, commit, committedAt, ...parsed(text) });
      }
    }
  }
  return { files };
}

export function createGitRepositoryReader(options: { cacheDir: string; timeoutMs?: number }): RepositoryReader {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const git = gitWithin(timeoutMs);
  return {
    read: async (repositories, { fetch: isFetched }) => {
      const files: SourceFile[] = [];
      const fetched: { name: string; error: string | null }[] = [];
      for (const repository of repositories) {
        let fetchFailure: unknown;
        const isFetching = isFetched(repository.name);
        if (isFetching) {
          try {
            await fetchMirror(git, { repository, cacheDir: options.cacheDir });
          } catch (error) {
            fetchFailure = error ?? new Error('git could not fetch the repository');
          }
        }
        const mirror = mirrorOf(repository, options.cacheDir);
        if (existsSync(mirror)) {
          const read = await filesIn(git, { repository, mirror });
          files.push(...read.files);
          fetchFailure ??= read.failure;
        }
        if (isFetching) {
          fetched.push({ name: repository.name, error: fetchFailure === undefined ? null : fetchErrorOf(fetchFailure, { token: repository.token, timeoutMs }) });
        }
      }
      return { files, fetched };
    },
    forget: (repository) => {
      rmSync(mirrorOf(repository, options.cacheDir), { recursive: true, force: true });
      return Promise.resolve();
    },
  };
}
