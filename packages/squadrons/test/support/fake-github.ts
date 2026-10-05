import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * GitHub's REST API as squadrons reads it, in memory: a repository's tags,
 * the commit each points at with its time, and the files at that commit. A
 * private repository answers only a request with its token, and 404 like
 * GitHub to any other. A tag list carries an ETag and answers 304 to a
 * request that names it, as GitHub does without counting it against the
 * rate limit. Every request is logged with its answer's status, so tests can
 * see what was read, how often, and what it cost.
 */

export interface FakeTag {
  name: string;
  sha: string;
  committedAt: Date;
  /** The files at the tag's commit, by path. */
  files: Record<string, string>;
}

export interface FakeRepository {
  tags: FakeTag[];
  /** Set for a private repository: the only token that reads it. */
  token?: string;
}

export interface FakeGithub {
  /** The API's base URL, as squadrons is given it. */
  apiUrl: string;
  /** The repositories, by `<owner>/<name>`; change them freely between reads. */
  repositories: Map<string, FakeRepository>;
  /** Every request: its path (with query), its authorization header and the status it was answered with. */
  requests: { path: string; authorization: string | undefined; status: number }[];
  /** How long to wait before answering, for timeouts. */
  delayMs: number;
  close: () => Promise<void>;
}

/** A Git commit sha for a test: 40 hex characters, one per label. */
export function shaOf(label: string): string {
  return createHash('sha1').update(label).digest('hex');
}

const TAGS = /^\/repos\/([^/]+\/[^/]+)\/tags$/;
const COMMIT = /^\/repos\/([^/]+\/[^/]+)\/commits\/([0-9a-f]{40})$/;
const CONTENTS = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/;
const TREE = /^\/repos\/([^/]+\/[^/]+)\/git\/trees\/([0-9a-f]{40})$/;
const NOT_FOUND = { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' };

/** The request being answered and its log entry, which records the status it is answered with. */
interface Exchange {
  request: IncomingMessage;
  response: ServerResponse;
  logged: { status: number };
}

function send({ response, logged }: Exchange, { status, body, headers = {} }: { status: number; body: unknown; headers?: Record<string, string> }): void {
  logged.status = status;
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(status === 304 ? undefined : JSON.stringify(body));
}

function answer(github: FakeGithub, { request, response }: { request: IncomingMessage; response: ServerResponse }): void {
  const url = new URL(request.url ?? '/', github.apiUrl);
  const authorization = request.headers.authorization;
  const logged = { path: `${url.pathname}${url.search}`, authorization, status: 0 };
  github.requests.push(logged);
  const exchange: Exchange = { request, response, logged };
  const owner = TAGS.exec(url.pathname)?.[1] ?? COMMIT.exec(url.pathname)?.[1] ?? CONTENTS.exec(url.pathname)?.[1] ?? TREE.exec(url.pathname)?.[1] ?? '';
  const repository = github.repositories.get(owner);
  if (!repository) {
    send(exchange, { status: 404, body: NOT_FOUND });
    return;
  }
  if (repository.token !== undefined && authorization !== `Bearer ${repository.token}`) {
    // GitHub answers a wrong token 401 and a private repository read without one 404.
    send(exchange, authorization === undefined ? { status: 404, body: NOT_FOUND } : { status: 401, body: { message: 'Bad credentials' } });
    return;
  }
  if (TAGS.test(url.pathname)) {
    const perPage = Number(url.searchParams.get('per_page') ?? '30');
    const page = Number(url.searchParams.get('page') ?? '1');
    const tags = repository.tags.slice((page - 1) * perPage, page * perPage).map((tag) => ({ name: tag.name, commit: { sha: tag.sha } }));
    const hasNext = page * perPage < repository.tags.length;
    const next = new URL(url);
    next.searchParams.set('page', String(page + 1));
    const etag = `W/"${shaOf(JSON.stringify(tags))}"`;
    if (request.headers['if-none-match'] === etag) {
      send(exchange, { status: 304, body: undefined, headers: { etag } });
      return;
    }
    send(exchange, { status: 200, body: tags, headers: { etag, ...(hasNext ? { link: `<${next.toString()}>; rel="next"` } : {}) } });
    return;
  }
  const tree = TREE.exec(url.pathname);
  if (tree) {
    const tag = repository.tags.find((each) => each.sha === tree[2]);
    if (tag && url.searchParams.get('recursive') === '1') {
      send(exchange, { status: 200, body: { sha: tag.sha, tree: Object.keys(tag.files).map((path) => ({ path, type: 'blob' })), truncated: false } });
    } else {
      send(exchange, { status: 404, body: NOT_FOUND });
    }
    return;
  }
  const commit = COMMIT.exec(url.pathname);
  if (commit) {
    const tag = repository.tags.find((each) => each.sha === commit[2]);
    if (tag) {
      send(exchange, { status: 200, body: { sha: tag.sha, commit: { committer: { date: tag.committedAt.toISOString() } } } });
    } else {
      send(exchange, { status: 404, body: NOT_FOUND });
    }
    return;
  }
  const contents = CONTENTS.exec(url.pathname);
  const tag = repository.tags.find((each) => each.sha === url.searchParams.get('ref'));
  const text = tag?.files[decodeURIComponent(contents?.[2] ?? '')];
  if (text === undefined || request.headers.accept !== 'application/vnd.github.raw+json') {
    send(exchange, { status: 404, body: NOT_FOUND });
    return;
  }
  logged.status = 200;
  response.writeHead(200, { 'content-type': 'application/vnd.github.raw+json' });
  response.end(text);
}

export async function startFakeGithub(): Promise<FakeGithub> {
  const server: Server = createServer((request, response) => {
    setTimeout(() => {
      answer(github, { request, response });
    }, github.delayMs);
  });
  const github: FakeGithub = {
    apiUrl: '',
    repositories: new Map(),
    requests: [],
    delayMs: 0,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the fake GitHub listens on no port');
  }
  github.apiUrl = `http://127.0.0.1:${String(address.port)}`;
  return github;
}

/** Tags that all point at one commit holding the files, as `git tag` on one commit gives. */
export function tagsAt(commit: { files: Record<string, string>; committedAt?: Date }, ...names: string[]): FakeTag[] {
  const sha = shaOf(JSON.stringify(commit.files));
  return names.map((name) => ({ name, sha, committedAt: commit.committedAt ?? new Date('2026-10-01T10:00:00.000Z'), files: commit.files }));
}
