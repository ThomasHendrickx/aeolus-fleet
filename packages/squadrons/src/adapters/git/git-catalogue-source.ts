/**
 * Templates and blueprints from git (docs/squadrons.md, "Files in git"), with
 * the git command line. Each fleet's repository is kept as its own bare mirror
 * in the cache folder, so one fleet never reads what another fetched; fetching brings it up to date with its tags, and a repository read
 * without fetching gives what its mirror holds, nothing before its first
 * fetch. A version is a tag `<name>@<n>`; its file is
 * `<path>/templates/<name>.yaml` or `<path>/blueprints/<name>.yaml` at the
 * tag's commit. A token, for a private repository, travels as basic
 * authentication on the fetch only, and never appears in what a failed fetch
 * says.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
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

/** The basic authentication a token travels as: GitHub takes a token as the password of any user, x-access-token the name it documents. */
function basicCredentials(token: string): string {
  return Buffer.from(`x-access-token:${token}`).toString('base64');
}

function authArguments(token: string | null): string[] {
  return token === null ? [] : ['-c', `http.extraHeader=Authorization: Basic ${basicCredentials(token)}`];
}

/**
 * What a failed fetch says: the last line git wrote to standard error, never
 * the command (which holds the token's header), with the token and its
 * credentials blanked should git ever repeat them.
 */
function fetchErrorOf(error: unknown, token: string | null): string {
  const stderr = typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  const line = stderr.split('\n').map((each) => each.trim()).filter((each) => each !== '').at(-1) ?? 'git could not fetch the repository';
  const said = line.replace(/^fatal: /, '');
  const blanked = token === null ? said : said.split(token).join('***').split(basicCredentials(token)).join('***');
  return blanked.slice(0, FETCH_ERROR_MAX_LENGTH);
}

async function git(mirror: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', mirror, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function mirrorOf(repository: RepositoryToRead, cacheDir: string): string {
  return join(cacheDir, createHash('sha256').update(`${repository.fleetId} ${repository.url}`).digest('hex').slice(0, 16));
}

/** Brings the repository's mirror up to date with its tags, cloning it the first time. */
async function fetchMirror(repository: RepositoryToRead, cacheDir: string): Promise<void> {
  const mirror = mirrorOf(repository, cacheDir);
  if (!existsSync(mirror)) {
    mkdirSync(cacheDir, { recursive: true });
    await run('git', [...authArguments(repository.token), 'clone', '--bare', '--quiet', repository.url, mirror]);
  }
  await run('git', ['-C', mirror, ...authArguments(repository.token), 'fetch', '--quiet', '--prune', 'origin', '+refs/tags/*:refs/tags/*']);
}

/** Every tag with the commit it points at (an annotated tag peeled) and that commit's time. */
async function tags(mirror: string): Promise<{ tag: string; commit: string; committedAt: Date }[]> {
  const output = await git(
    mirror,
    'for-each-ref',
    '--format=%(refname:short)%09%(if)%(*objectname)%(then)%(*objectname)%09%(*committerdate:iso-strict)%(else)%(objectname)%09%(committerdate:iso-strict)%(end)',
    'refs/tags',
  );
  return output
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [tag = '', commit = '', committedAt = ''] = line.split('\t');
      return { tag, commit, committedAt: new Date(committedAt) };
    });
}

/** The file at the commit; undefined when the commit has no such file. */
async function fileAt(mirror: string, at: { commit: string; path: string }): Promise<string | undefined> {
  try {
    return await git(mirror, 'show', `${at.commit}:${at.path}`);
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

/** Every tagged template and blueprint version in a repository's mirror. */
async function filesIn(repository: RepositoryToRead, mirror: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const { tag, commit, committedAt } of await tags(mirror)) {
    const version = VERSION_TAG.exec(tag);
    if (!version) {
      continue;
    }
    const [, name = '', number = ''] = version;
    for (const { kind, folder } of KINDS) {
      const file = `${repository.path}/${folder}/${name}.yaml`;
      const text = await fileAt(mirror, { commit, path: file });
      if (text !== undefined) {
        files.push({ repository: repository.name, kind, name, version: Number(number), file, commit, committedAt, ...parsed(text) });
      }
    }
  }
  return files;
}

export function createGitRepositoryReader(options: { cacheDir: string }): RepositoryReader {
  return {
    read: async (repositories, { fetch: isFetched }) => {
      const files: SourceFile[] = [];
      const fetched: { name: string; error: string | null }[] = [];
      for (const repository of repositories) {
        if (isFetched(repository.name)) {
          try {
            await fetchMirror(repository, options.cacheDir);
            fetched.push({ name: repository.name, error: null });
          } catch (error) {
            fetched.push({ name: repository.name, error: fetchErrorOf(error, repository.token) });
          }
        }
        const mirror = mirrorOf(repository, options.cacheDir);
        if (existsSync(mirror)) {
          files.push(...(await filesIn(repository, mirror)));
        }
      }
      return { files, fetched };
    },
  };
}
