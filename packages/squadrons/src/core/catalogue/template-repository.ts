import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** The folder of templates/ and blueprints/ in a repository unless it gives its own (#160). */
export const DEFAULT_PATH = '.aeolus/squadrons';

/** The longest read token squadrons takes. */
const TOKEN_MAX_LENGTH = 1024;
/** A path within a repository: folders of letters, digits, dots, underscores and hyphens. */
const PATH_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * A git repository squadrons reads templates and blueprints from (#161), set
 * by the operator in the console: runtime configuration, never a file.
 */
export interface TemplateRepository {
  fleetId: FleetId;
  /** What blueprints reference it by: its URL without the scheme and `.git`. */
  name: string;
  url: string;
  /** The folder holding templates/ and blueprints/. */
  path: string;
  /** A read token for a private repository: written once, never shown again. */
  token: string | null;
  addedAt: Date;
  /** Its last fetch: when, and why it failed (null when it worked); null before its first. */
  lastFetch: { at: Date; error: string | null } | null;
}

/** A repository as the operator reads it back: whether it has a token, never the token. */
export interface ListedRepository {
  name: string;
  url: string;
  path: string;
  hasToken: boolean;
  addedAt: Date;
  lastFetch: TemplateRepository['lastFetch'];
}

export function listedRepositoryOf(repository: TemplateRepository): ListedRepository {
  const { name, url, path, token, addedAt, lastFetch } = repository;
  return { name, url, path, hasToken: token !== null, addedAt, lastFetch };
}

function isSafePath(path: string): boolean {
  return PATH_PATTERN.test(path) && path.split('/').every((segment) => segment !== '.' && segment !== '..');
}

/**
 * What the operator gives for a repository, checked: an https URL of a
 * repository, with no credentials, query or fragment (a token is given apart),
 * a path inside the repository, and a token of 1 to 1024 characters.
 */
export function parseRepositoryInput(input: {
  url: string;
  path?: string;
  token?: string;
}): Result<{ url: string; name: string; path: string; token: string | null }, DomainError<'INVALID_REPOSITORY'>> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return refuse('INVALID_REPOSITORY', `${input.url} is no URL: give the repository's https URL`);
  }
  const repositoryPath = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || repositoryPath === '') {
    return refuse('INVALID_REPOSITORY', 'Give the repository\'s https URL, with no credentials in it: a private repository takes a read token instead');
  }
  const path = input.path ?? DEFAULT_PATH;
  if (!isSafePath(path)) {
    return refuse('INVALID_REPOSITORY', `${path} is no folder inside the repository`);
  }
  if (input.token?.length === 0 || (input.token?.length ?? 0) > TOKEN_MAX_LENGTH) {
    return refuse('INVALID_REPOSITORY', `A read token holds 1 to ${String(TOKEN_MAX_LENGTH)} characters`);
  }
  return ok({ url: input.url, name: `${url.host}${repositoryPath}`, path, token: input.token ?? null });
}
