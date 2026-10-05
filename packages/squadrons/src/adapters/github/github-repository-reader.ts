/**
 * Templates and blueprints from GitHub (docs/squadrons.md, "Files in git"),
 * through its REST API: no clone, no disk, and no git that could fall back
 * to the host's credentials (S5). A version is a tag `<name>@<n>`; its file
 * is `<path>/templates/<name>.yaml` or `<path>/blueprints/<name>.yaml` at the
 * tag's commit, a 404 meaning no such file; a version tag with neither file,
 * or one whose name is not lowercase (`Tester@1`), is handed back so the
 * catalogue can say why. A repository is read with its
 * own token only, as a bearer token, and unauthenticated without one.
 *
 * What a commit holds never changes, so what is read at one is kept by
 * repository and commit, for every fleet: a commit's tree and time, and each
 * file read at it. A fetch asks for the tag list with the ETag of the last
 * answer, so an unchanged repository costs a 304, which GitHub does not count
 * against its rate limit, and reads nothing more. A new commit costs one tree
 * and one commit call, and one read per file that exists there: no 404s.
 * Each fleet asks for the tag list itself, with its own token, before it is
 * given anything kept; an ETag is kept per token. What a repository last
 * fetched is kept per fleet, in memory, for reads without a fetch; nothing is
 * kept before its first fetch or after it is forgotten.
 */
import { parse, YAMLParseError } from 'yaml';
import { z } from 'zod';

import type { RepositoryReader, RepositoryToRead, SourceFile, UnreadTag } from '../../core/catalogue/ports.js';

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
const HTTP_NOT_MODIFIED = 304;
const HTTP_UNAUTHORIZED = 401;

const VERSION_TAG = /^([a-z0-9:-]+)@([1-9]\d*)$/;
/** A tag shaped like a version tag whatever its name, such as `Tester@1`: read nothing at, but reported. */
const VERSION_SHAPED_TAG = /^[^@\s]+@[1-9]\d*$/;
const NEXT_PAGE = /<([^>]+)>;\s*rel="next"/;
const KINDS = [
  { kind: 'template', folder: 'templates' },
  { kind: 'blueprint', folder: 'blueprints' },
] as const;

const tagsSchema = z.array(z.object({ name: z.string(), commit: z.object({ sha: z.string() }) }));
const commitSchema = z.object({ commit: z.object({ committer: z.object({ date: z.iso.datetime({ offset: true }) }) }) });
const treeSchema = z.object({ tree: z.array(z.object({ path: z.string(), type: z.string() })), truncated: z.boolean() });
const errorSchema = z.object({ message: z.string() });

/** Why a fetch failed, as the operator reads it; never holds the token. */
class FetchFailure extends Error {
  override name = 'FetchFailure';
}

/** What a commit holds, as far as squadrons reads it: its time, and the paths of its files (undefined when GitHub cut the tree short). */
interface Commit {
  committedAt: Date;
  paths: ReadonlySet<string> | undefined;
}

/** One page of a tag list as last answered, with its ETag. */
interface TagPage {
  etag: string;
  tags: { name: string; commit: string }[];
  next: string | undefined;
}

/** What the reader keeps of one fleet's repository. */
interface Kept {
  /** What its last fetch read. */
  files: SourceFile[];
  /** The version tags its last fetch read no file at. */
  unread: UnreadTag[];
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
  /** Each commit read, by `<repository> <sha>`, for every fleet. */
  const commits = new Map<string, Commit>();
  /** Each file read, by `<repository> <sha> <path>`, for every fleet. */
  const texts = new Map<string, string>();
  /** Each tag list page last answered, by its URL and the token it was asked with. */
  const tagPages = new Map<string, TagPage>();

  /** A GET with the repository's own token, if any; a 404 answers undefined when `isMissingFine`; a 304 answers as it is. */
  const get = async (url: string, request: { token: string | null; accept: string; isMissingFine?: boolean; etag?: string }): Promise<Response | undefined> => {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept: request.accept,
          'x-github-api-version': GITHUB_API_VERSION,
          'user-agent': 'aeolus-squadrons',
          ...(request.token === null ? {} : { authorization: `Bearer ${request.token}` }),
          ...(request.etag === undefined ? {} : { 'if-none-match': request.etag }),
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
    if (response.status === HTTP_NOT_MODIFIED && request.etag !== undefined) {
      return response;
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

  /** One page of the tag list, asked with the ETag of its last answer under this token: a 304 gives that answer again, free. */
  const tagPageOf = async (url: string, token: string | null): Promise<TagPage> => {
    const pageKey = `${url} ${token ?? ''}`;
    const known = tagPages.get(pageKey);
    const response = await get(url, { token, accept: 'application/vnd.github+json', ...(known === undefined ? {} : { etag: known.etag }) });
    if (known !== undefined && response?.status === HTTP_NOT_MODIFIED) {
      return known;
    }
    const page: TagPage = {
      etag: response?.headers.get('etag') ?? '',
      tags: tagsSchema.parse(await response?.json()).map((tag) => ({ name: tag.name, commit: tag.commit.sha })),
      next: NEXT_PAGE.exec(response?.headers.get('link') ?? '')?.[1],
    };
    if (page.etag !== '') {
      tagPages.set(pageKey, page);
    }
    return page;
  };

  /** Every tag of the repository with the commit it points at, page by page. */
  const tagsOf = async (repository: RepositoryToRead): Promise<{ name: string; commit: string }[]> => {
    const tags: { name: string; commit: string }[] = [];
    let url: string | undefined = `${apiUrl}/repos/${slugOf(repository)}/tags?per_page=${String(TAGS_PER_PAGE)}`;
    while (url !== undefined) {
      const page: TagPage = await tagPageOf(url, repository.token);
      tags.push(...page.tags);
      url = page.next;
    }
    return tags;
  };

  /** A commit's time and the paths of its files: read once, by its tree and its commit, for every fleet. */
  const commitOf = async (repository: RepositoryToRead, sha: string): Promise<Commit> => {
    const commitKey = `${repository.name} ${sha}`;
    const known = commits.get(commitKey);
    if (known !== undefined) {
      return known;
    }
    const tree = treeSchema.parse((await json(`${apiUrl}/repos/${slugOf(repository)}/git/trees/${sha}?recursive=1`, repository.token)).body);
    const committed = commitSchema.parse((await json(`${apiUrl}/repos/${slugOf(repository)}/commits/${sha}`, repository.token)).body);
    const commit: Commit = {
      committedAt: new Date(committed.commit.committer.date),
      paths: tree.truncated ? undefined : new Set(tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path)),
    };
    commits.set(commitKey, commit);
    return commit;
  };

  /** A file's text at a commit, read once for every fleet; undefined when the commit holds no such file. */
  const textOf = async (repository: RepositoryToRead, at: { sha: string; commit: Commit; file: string }): Promise<string | undefined> => {
    const textKey = `${repository.name} ${at.sha} ${at.file}`;
    const known = texts.get(textKey);
    if (known !== undefined) {
      return known;
    }
    if (at.commit.paths !== undefined && !at.commit.paths.has(at.file)) {
      return undefined;
    }
    const path = at.file.split('/').map(encodeURIComponent).join('/');
    const response = await get(`${apiUrl}/repos/${slugOf(repository)}/contents/${path}?ref=${at.sha}`, {
      token: repository.token,
      accept: 'application/vnd.github.raw+json',
      isMissingFine: true,
    });
    if (!response) {
      return undefined;
    }
    const text = await response.text();
    texts.set(textKey, text);
    return text;
  };

  /** The tag's template and blueprint of its name at its commit, with the commit's time. */
  const readTag = async (repository: RepositoryToRead, tag: { name: string; version: number; commit: string }): Promise<SourceFile[]> => {
    const commit = await commitOf(repository, tag.commit);
    const files: SourceFile[] = [];
    for (const { kind, folder } of KINDS) {
      const file = `${repository.path}/${folder}/${tag.name}.yaml`;
      const text = await textOf(repository, { sha: tag.commit, commit, file });
      if (text !== undefined) {
        files.push({ repository: repository.name, kind, name: tag.name, version: tag.version, file, commit: tag.commit, committedAt: commit.committedAt, ...parsed(text) });
      }
    }
    return files;
  };

  /** Fetches the repository: its tags, and each tag's files from what is kept of its commit, read only when new. */
  const fetchRepository = async (repository: RepositoryToRead): Promise<void> => {
    const files: SourceFile[] = [];
    const unread: UnreadTag[] = [];
    for (const { name: tagName, commit } of await tagsOf(repository)) {
      const version = VERSION_TAG.exec(tagName);
      if (!version) {
        if (VERSION_SHAPED_TAG.test(tagName)) {
          unread.push({ repository: repository.name, tag: tagName, path: repository.path });
        }
        continue;
      }
      const [, name = '', number = ''] = version;
      const read = await readTag(repository, { name, version: Number(number), commit });
      files.push(...read);
      if (read.length === 0) {
        unread.push({ repository: repository.name, tag: tagName, path: repository.path });
      }
    }
    kept.set(keyOf(repository), { files, unread });
  };

  return {
    read: async (repositories, { fetch: isFetched }) => {
      const files: SourceFile[] = [];
      const tags: UnreadTag[] = [];
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
        tags.push(...(kept.get(keyOf(repository))?.unread ?? []));
      }
      return { files, tags, fetched };
    },
    forget: (repository) => {
      kept.delete(keyOf(repository));
      return Promise.resolve();
    },
  };
}
