import type { Catalogue, CatalogueProblem } from './squadrons-api';

/**
 * How the console names a template repository (#161): one on github.com as
 * owner/repo with the GitHub mark, github.com/acme/templates reading as
 * acme/templates; any other by its name as squadrons derives it from the URL.
 */
export function repositoryLabel(name: string): { label: string; isGitHub: boolean } {
  const match = /^github\.com\/([^/]+\/[^/]+)$/.exec(name);
  return match?.[1] === undefined ? { label: name, isGitHub: false } : { label: match[1], isGitHub: true };
}

/**
 * Where a template or blueprint version's file is on GitHub (#185): the file at
 * the version's commit, which its tag points at. Undefined for a repository not
 * on github.com, which the console has no link for.
 */
export function versionFileUrl(version: { repository: string; commit: string; file: string }): string | undefined {
  const { label, isGitHub } = repositoryLabel(version.repository);
  return isGitHub ? `https://github.com/${label}/blob/${version.commit}/${encodeURI(version.file)}` : undefined;
}

/** The versions of one template or blueprint, by its name. */
export interface NamedVersions {
  name: string;
  versions: number[];
}

/** What squadrons read from one repository: its template and blueprint versions, and what it left out with why. */
export interface RepositoryContents {
  templates: NamedVersions[];
  blueprints: NamedVersions[];
  leftOut: CatalogueProblem[];
}

function byName(versions: readonly { repository: string; name: string; version: number }[], repository: string): NamedVersions[] {
  const named = new Map<string, number[]>();
  for (const { name, version } of versions.filter((each) => each.repository === repository)) {
    named.set(name, [...(named.get(name) ?? []), version]);
  }
  return [...named]
    .map(([name, numbers]) => ({ name, versions: numbers.toSorted((one, other) => one - other) }))
    .toSorted((one, other) => one.name.localeCompare(other.name));
}

/** One repository's part of the catalogue, for its row in Settings: names in order, versions oldest first, what was left out as squadrons lists it. */
export function repositoryContents(catalogue: Catalogue, repository: string): RepositoryContents {
  return {
    templates: byName(catalogue.templates, repository),
    blueprints: byName(catalogue.blueprints, repository),
    leftOut: catalogue.problems.filter((problem) => problem.repository === repository),
  };
}

/** How the console names a version left out: a template as tester@4, a blueprint as team v4, a tag as itself. */
export function leftOutLabel(problem: Pick<CatalogueProblem, 'kind' | 'name' | 'version'>): string {
  const { kind, name, version } = problem;
  return kind === 'blueprint' ? `blueprint ${name} v${String(version)}` : `${kind} ${name}@${String(version)}`;
}
