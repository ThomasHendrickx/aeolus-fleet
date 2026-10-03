/**
 * Templates and blueprints from git (docs/squadrons.md, "Files in git"), with
 * the git command line. Each repository is kept as a bare mirror in the cache
 * folder and fetched again on every read, so a new tag shows. A version is a
 * tag `<name>@<n>`; its file is `<path>/templates/<name>.yaml` or
 * `<path>/blueprints/<name>.yaml` at the tag's commit. A token, for a private
 * repository, travels as basic authentication on the fetch only.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { parse, YAMLParseError } from 'yaml';

import type { CatalogueSource, SourceFile } from '../../core/catalogue/ports.js';

const run = promisify(execFile);

/** The folder of templates/ and blueprints/ in a repository unless it sets its own. */
export const DEFAULT_PATH = 'squadrons';

const VERSION_TAG = /^([a-z0-9:-]+)@([1-9]\d*)$/;
const KINDS = [
  { kind: 'template', folder: 'templates' },
  { kind: 'blueprint', folder: 'blueprints' },
] as const;

export interface GitRepository {
  url: string;
  /** What blueprints reference it by. */
  name: string;
  /** The folder holding templates/ and blueprints/; squadrons/ when undefined. */
  path: string | undefined;
  /** A read token for a private repository. */
  token: string | undefined;
}

function authArguments(token: string | undefined): string[] {
  // GitHub takes a token as the password of any user; x-access-token is the name it documents.
  return token === undefined ? [] : ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`];
}

async function git(mirror: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', mirror, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/** Brings the repository's mirror up to date with its tags, cloning it the first time. */
async function fetched(repository: GitRepository, cacheDir: string): Promise<string> {
  const mirror = join(cacheDir, createHash('sha256').update(repository.url).digest('hex').slice(0, 16));
  if (!existsSync(mirror)) {
    mkdirSync(cacheDir, { recursive: true });
    await run('git', [...authArguments(repository.token), 'clone', '--bare', '--quiet', repository.url, mirror]);
  }
  await run('git', ['-C', mirror, ...authArguments(repository.token), 'fetch', '--quiet', '--prune', 'origin', '+refs/tags/*:refs/tags/*']);
  return mirror;
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

export function createGitCatalogueSource(options: { repositories: readonly GitRepository[]; cacheDir: string }): CatalogueSource {
  return {
    files: async () => {
      const files: SourceFile[] = [];
      for (const repository of options.repositories) {
        const mirror = await fetched(repository, options.cacheDir);
        const folder = repository.path ?? DEFAULT_PATH;
        for (const { tag, commit, committedAt } of await tags(mirror)) {
          const version = VERSION_TAG.exec(tag);
          if (!version) {
            continue;
          }
          const [, name = '', number = ''] = version;
          for (const { kind, folder: kindFolder } of KINDS) {
            const file = `${folder}/${kindFolder}/${name}.yaml`;
            const text = await fileAt(mirror, { commit, path: file });
            if (text !== undefined) {
              files.push({ repository: repository.name, kind, name, version: Number(number), file, commit, committedAt, ...parsed(text) });
            }
          }
        }
      }
      return files;
    },
  };
}
