/**
 * Templates and blueprints from GitHub (docs/squadrons.md, "Files in git"),
 * through its REST API: no clone, no disk, and no git that could fall back
 * to the host's credentials (S5). A version is a tag `<name>@<n>`; its file
 * is `<path>/templates/<name>.yaml` or `<path>/blueprints/<name>.yaml` at the
 * tag's commit, a 404 meaning no such file. A repository is read with its
 * own token only, as a bearer token, and unauthenticated without one.
 *
 * A tag's files at a commit never change, so each fleet's reader keeps them
 * and reads a tag again only when it points at another commit. What a
 * repository last fetched is kept per fleet, in memory, for reads without a
 * fetch; nothing is kept before its first fetch or after it is forgotten.
 */
import { parse, YAMLParseError } from 'yaml';
import { z } from 'zod';

import type { RepositoryReader, RepositoryToRead, SourceFile } from '../../core/catalogue/ports.js';

/** GitHub's REST API, unless the reader is given another (a test's fake). */
const GITHUB_API_URL = 'https://api.github.com';
/** The REST API version squadrons is written against. */
const GITHUB_API_VERSION = '2022-11-28';
/** How long one request may take before squadrons gives up on it. */
const DEFAULT_TIMEOUT_MS = 30_000;
/** The most tags GitHub answers per page. */
const TAGS_PER_PAGE = 100;
/** The longest account of a failed fetch squadrons keeps. */
const FETCH_ERROR_MAX_LENGTH = 300;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;

const VERSION_TAG = /^([a-z0-9:-]+)@([1-9]\d*)$/;
const NEXT_PAGE = /<([^>]+)>;\s*rel="next"/;
const KINDS = [
  { kind: 'template', folder: 'templates' },
  { kind: 'blueprint', folder: 'blueprints' },
] as const;

const tagsSchema = z.array(z.object({ name: z.string(), commit: z.object({ sha: z.string() }) }));
const commitSchema = z.object({ commit: z.object({ committer: z.object({ date: z.iso.datetime({ offset: true }) }) }) });
const errorSchema = z.object({ message: z.string() });

/** Why a fetch failed, as the operator reads it; never holds the token. */
class FetchFailure extends Error {
  override name = 'FetchFailure';
}

/** One tag's versions, read at the commit it pointed at. */
interface ReadTag {
  commit: string;
  files: SourceFile[];
}

/** What the reader keeps of one fleet's repository. */
interface Kept {
  /** Each tag read, by tag name. */
  tags: Map<string, ReadTag>;
  /** What its last fetch read. */
  files: SourceFile[];
}

function keyOf(repository: Pick<RepositoryToRead, 'fleetId' | 'url'>): string {
  return `${repository.fleetId} ${repository.url}`;
}

/** The repository's owner and name, as the API addresses it: `acme/templates` of `github.com/acme/templates`. */
function slugOf(repository: RepositoryToRead): string {
  return repository.name.replace(/^github\.com\//, '');
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

/** What a refused request says: GitHub's status and message, and what it means here. */
async function refusalOf(response: Response): Promise<FetchFailure> {
  const body = errorSchema.safeParse(await response.json().catch(() => undefined));
  const said = `GitHub answered ${String(response.status)} ${body.success ? body.data.message : response.statusText}`;
  if (response.status === HTTP_NOT_FOUND) {
    return new FetchFailure(`${said}: no such repository, or a private one its token cannot read`);
  }
  if (response.status === HTTP_UNAUTHORIZED) {
    return new FetchFailure(`${said}: its token cannot read it`);
  }
  return new FetchFailure(said);
}

export function createGithubRepositoryReader(options: { apiUrl?: string; timeoutMs?: number } = {}): RepositoryReader {
  const apiUrl = options.apiUrl ?? GITHUB_API_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const kept = new Map<string, Kept>();

  /** A GET with the repository's own token, if any; a 404 answers undefined when `isMissingFine`. */
  const get = async (url: string, request: { token: string | null; accept: string; isMissingFine?: boolean }): Promise<Response | undefined> => {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept: request.accept,
          'x-github-api-version': GITHUB_API_VERSION,
          'user-agent': 'aeolus-squadrons',
          ...(request.token === null ? {} : { authorization: `Bearer ${request.token}` }),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new FetchFailure(`GitHub did not answer within ${String(timeoutMs / 1000)} seconds`);
      }
      throw new FetchFailure('GitHub could not be reached');
    }
    if (response.status === HTTP_NOT_FOUND && request.isMissingFine === true) {
      return undefined;
    }
    if (!response.ok) {
      throw await refusalOf(response);
    }
    return response;
  };

  const json = async (url: string, token: string | null): Promise<{ body: unknown; next: string | undefined }> => {
    const response = await get(url, { token, accept: 'application/vnd.github+json' });
    const next = NEXT_PAGE.exec(response?.headers.get('link') ?? '')?.[1];
    return { body: await response?.json(), next };
  };

  /** Every tag of the repository with the commit it points at, page by page. */
  const tagsOf = async (repository: RepositoryToRead): Promise<{ name: string; commit: string }[]> => {
    const tags: { name: string; commit: string }[] = [];
    let url: string | undefined = `${apiUrl}/repos/${slugOf(repository)}/tags?per_page=${String(TAGS_PER_PAGE)}`;
    while (url !== undefined) {
      const page: { body: unknown; next: string | undefined } = await json(url, repository.token);
      tags.push(...tagsSchema.parse(page.body).map((tag) => ({ name: tag.name, commit: tag.commit.sha })));
      url = page.next;
    }
    return tags;
  };

  /** The tag's template and blueprint of its name at its commit, with the commit's time. */
  const readTag = async (repository: RepositoryToRead, tag: { name: string; version: number; tagName: string; commit: string }): Promise<SourceFile[]> => {
    const files: SourceFile[] = [];
    let committedAt: Date | undefined;
    for (const { kind, folder } of KINDS) {
      const file = `${repository.path}/${folder}/${tag.name}.yaml`;
      const path = file.split('/').map(encodeURIComponent).join('/');
      const response = await get(`${apiUrl}/repos/${slugOf(repository)}/contents/${path}?ref=${tag.commit}`, {
        token: repository.token,
        accept: 'application/vnd.github.raw+json',
        isMissingFine: true,
      });
      if (response) {
        const text = await response.text();
        committedAt ??= new Date(commitSchema.parse((await json(`${apiUrl}/repos/${slugOf(repository)}/commits/${tag.commit}`, repository.token)).body).commit.committer.date);
        files.push({ repository: repository.name, kind, name: tag.name, version: tag.version, file, commit: tag.commit, committedAt, ...parsed(text) });
      }
    }
    return files;
  };

  /** Fetches the repository: its tags, and each tag's files not read yet at its commit. */
  const fetchRepository = async (repository: RepositoryToRead): Promise<SourceFile[]> => {
    const before = kept.get(keyOf(repository))?.tags ?? new Map<string, ReadTag>();
    const tags = new Map<string, ReadTag>();
    for (const { name: tagName, commit } of await tagsOf(repository)) {
      const version = VERSION_TAG.exec(tagName);
      if (!version) {
        continue;
      }
      const [, name = '', number = ''] = version;
      const known = before.get(tagName);
      tags.set(tagName, known?.commit === commit ? known : { commit, files: await readTag(repository, { name, version: Number(number), tagName, commit }) });
    }
    const files = [...tags.values()].flatMap((tag) => tag.files);
    kept.set(keyOf(repository), { tags, files });
    return files;
  };

  return {
    read: async (repositories, { fetch: isFetched }) => {
      const files: SourceFile[] = [];
      const fetched: { name: string; error: string | null }[] = [];
      for (const repository of repositories) {
        if (isFetched(repository.name)) {
          try {
            await fetchRepository(repository);
            fetched.push({ name: repository.name, error: null });
          } catch (error) {
            const said = error instanceof FetchFailure ? error.message : 'GitHub answered something squadrons cannot read';
            fetched.push({ name: repository.name, error: said.slice(0, FETCH_ERROR_MAX_LENGTH) });
          }
        }
        files.push(...(kept.get(keyOf(repository))?.files ?? []));
      }
      return { files, fetched };
    },
    forget: (repository) => {
      kept.delete(keyOf(repository));
      return Promise.resolve();
    },
  };
}
