import { describe, expect, it } from 'vitest';

import { DEFAULT_PATH, parseRepositoryInput } from './template-repository.js';

describe('a template repository the operator adds', () => {
  it('is named after its URL without the scheme and .git, which is what blueprints reference', () => {
    expect(parseRepositoryInput({ url: 'https://github.com/acme/templates.git' })).toEqual({
      isOk: true,
      value: { url: 'https://github.com/acme/templates.git', name: 'github.com/acme/templates', path: DEFAULT_PATH, token: null },
    });
  });

  it('reads from .aeolus/squadrons unless it gives its own path', () => {
    expect(DEFAULT_PATH).toBe('.aeolus/squadrons');
    expect(parseRepositoryInput({ url: 'https://gitlab.example.com/ops/fleet', path: 'ops/squadrons' })).toMatchObject({
      isOk: true,
      value: { name: 'gitlab.example.com/ops/fleet', path: 'ops/squadrons' },
    });
  });

  it('keeps a read token for a private repository', () => {
    expect(parseRepositoryInput({ url: 'https://github.com/acme/private', token: 'ghp_secret' })).toMatchObject({ isOk: true, value: { token: 'ghp_secret' } });
  });

  it.each([
    ['a file:// URL', 'file:///srv/templates'],
    ['an http:// URL', 'http://github.com/acme/templates'],
    ['an ssh URL', 'git@github.com:acme/templates.git'],
    ['a URL holding credentials', 'https://user:secret@github.com/acme/templates'],
    ['a URL with a query', 'https://github.com/acme/templates?ref=main'],
    ['a URL with no repository path', 'https://github.com'],
    ['no URL at all', 'templates'],
  ])('refuses %s: only an https URL of a repository, its token given apart', (_label, url) => {
    expect(parseRepositoryInput({ url })).toMatchObject({ isOk: false, error: { kind: 'INVALID_REPOSITORY' } });
  });

  it.each([
    ['an absolute path', '/etc/squadrons'],
    ['a path climbing out of the repository', 'ops/../../secrets'],
    ['an empty path', ''],
  ])('refuses %s', (_label, path) => {
    expect(parseRepositoryInput({ url: 'https://github.com/acme/templates', path })).toMatchObject({ isOk: false, error: { kind: 'INVALID_REPOSITORY' } });
  });

  it('refuses an empty token, and takes one of 1024 characters but not 1025', () => {
    expect(parseRepositoryInput({ url: 'https://github.com/acme/templates', token: '' })).toMatchObject({ isOk: false });
    expect(parseRepositoryInput({ url: 'https://github.com/acme/templates', token: 'x'.repeat(1024) })).toMatchObject({ isOk: true });
    expect(parseRepositoryInput({ url: 'https://github.com/acme/templates', token: 'x'.repeat(1025) })).toMatchObject({ isOk: false });
  });
});
