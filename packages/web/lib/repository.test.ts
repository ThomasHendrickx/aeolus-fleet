import { describe, expect, it } from 'vitest';

import { leftOutLabel, repositoryContents, repositoryLabel, versionFileUrl } from './repository';
import type { Catalogue } from './squadrons-api';

describe('repositoryLabel', () => {
  it('reads a github.com repository as owner/repo, with the GitHub mark', () => {
    expect(repositoryLabel('github.com/acme/templates')).toEqual({ label: 'acme/templates', isGitHub: true });
  });

  it('shows any other repository by its name', () => {
    expect(repositoryLabel('gitlab.com/acme/templates')).toEqual({ label: 'gitlab.com/acme/templates', isGitHub: false });
    expect(repositoryLabel('github.com/acme/group/templates')).toEqual({ label: 'github.com/acme/group/templates', isGitHub: false });
  });
});

describe('versionFileUrl', () => {
  it("links a github.com version to its file at the version's commit", () => {
    expect(versionFileUrl({ repository: 'github.com/acme/templates', commit: 'a1b2c3d4', file: '.aeolus/squadrons/templates/tester.yaml' })).toBe(
      'https://github.com/acme/templates/blob/a1b2c3d4/.aeolus/squadrons/templates/tester.yaml',
    );
  });

  it('has no link for a repository not on github.com', () => {
    expect(versionFileUrl({ repository: 'gitlab.com/acme/templates', commit: 'a1b2c3d4', file: 'templates/tester.yaml' })).toBeUndefined();
  });
});

const ACME = 'github.com/acme/templates';
const OTHER = 'github.com/other/templates';

/** A version of a repository, from its tag: `tester@2`. */
function aVersion(repository: string, tag: string) {
  const [name = '', version = ''] = tag.split('@');
  return { repository, name, version: Number(version) };
}

/** A catalogue holding only what repositoryContents reads; the rest of each version is not its concern. */
function aCatalogue(parts: { templates?: ReturnType<typeof aVersion>[]; blueprints?: ReturnType<typeof aVersion>[]; problems?: Catalogue['problems'] }): Catalogue {
  const template = { commit: 'c', committedAt: '2026-10-04T10:00:00.000Z', description: 'd', checkInMinutes: 30, model: null, launchNote: null, charter: 'c', handoffs: [], file: 'f' };
  const blueprint = { commit: 'c', committedAt: '2026-10-04T10:00:00.000Z', description: 'd', roles: [], handoffs: [], memberNames: 'plain' as const, file: 'f' };
  return {
    templates: (parts.templates ?? []).map((version) => ({ ...template, ...version })),
    blueprints: (parts.blueprints ?? []).map((version) => ({ ...blueprint, ...version })),
    problems: parts.problems ?? [],
  };
}

describe('repositoryContents', () => {
  it("lists one repository's templates and blueprints by name, each with its versions oldest first", () => {
    const catalogue = aCatalogue({
      templates: [aVersion(ACME, 'tester@2'), aVersion(ACME, 'planner@1'), aVersion(ACME, 'tester@1'), aVersion(OTHER, 'reviewer@1')],
      blueprints: [aVersion(ACME, 'team@1')],
    });

    expect(repositoryContents(catalogue, ACME)).toEqual({
      templates: [
        { name: 'planner', versions: [1] },
        { name: 'tester', versions: [1, 2] },
      ],
      blueprints: [{ name: 'team', versions: [1] }],
      leftOut: [],
    });
  });

  it('gives what was left out of that repository alone, with why, as squadrons lists it', () => {
    const tag = { repository: ACME, kind: 'tag' as const, name: 'reviewer', version: 1, message: 'the tag reviewer@1 points at a commit with neither file' };
    const template = { repository: ACME, kind: 'template' as const, name: 'tester', version: 3, message: 'checkIn must be a duration such as 30m or 2h' };
    const elsewhere = { repository: OTHER, kind: 'blueprint' as const, name: 'team', version: 1, message: 'roles is missing' };

    expect(repositoryContents(aCatalogue({ problems: [tag, template, elsewhere] }), ACME).leftOut).toEqual([tag, template]);
  });
});

describe('leftOutLabel', () => {
  it('names a template as tester@4, a blueprint as team v4, and a tag as itself', () => {
    expect(leftOutLabel({ kind: 'template', name: 'tester', version: 4 })).toBe('template tester@4');
    expect(leftOutLabel({ kind: 'blueprint', name: 'team', version: 4 })).toBe('blueprint team v4');
    expect(leftOutLabel({ kind: 'tag', name: 'Tester', version: 1 })).toBe('tag Tester@1');
  });
});
