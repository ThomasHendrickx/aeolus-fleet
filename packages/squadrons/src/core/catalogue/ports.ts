/** A template or blueprint file in git: which one, at which version (its tag `<name>@<n>`), and what it holds. */
export interface SourceFile {
  /** The repository's name, as blueprints reference it: `github.com/<owner>/<repo>`. */
  repository: string;
  kind: 'template' | 'blueprint';
  name: string;
  version: number;
  /** Its path within its repository at that commit: `.aeolus/squadrons/templates/tester.yaml`. */
  file: string;
  /** The commit the tag points at. */
  commit: string;
  committedAt: Date;
  /** The YAML, parsed; whatever it holds is checked here. */
  content: unknown;
  /** Why the YAML could not be parsed, when it could not. */
  parseError?: string;
}

import type { FleetId } from '@aeolus-fleet/common';

import type { Catalogue } from './catalogue.js';
import type { TemplateRepository } from './template-repository.js';

/** A repository to read: what reading it needs. */
export type RepositoryToRead = Pick<TemplateRepository, 'name' | 'url' | 'path' | 'token'>;

/**
 * Outbound port: the template and blueprint versions of the given
 * repositories (docs/squadrons.md, "Files in git"). A repository `fetch`
 * picks is fetched first, and answers whether that worked; every other is
 * read from what it last fetched, and holds nothing before its first fetch.
 */
export interface RepositoryReader {
  read(
    repositories: readonly RepositoryToRead[],
    options: { fetch: (name: string) => boolean },
  ): Promise<{ files: SourceFile[]; fetched: { name: string; error: string | null }[] }>;
}

/** Outbound port: the template repositories the operator set, in squadrons' own database, within one fleet. */
export interface RepositoryStore {
  /** The fleet's repositories, oldest first. */
  list(fleetId: FleetId): Promise<TemplateRepository[]>;
  /** Stores a repository; `taken` when the fleet has one of that name already. */
  add(repository: TemplateRepository): Promise<'added' | 'taken'>;
  /** Forgets a repository; false when there was none of that name. */
  remove(fleetId: FleetId, name: string): Promise<boolean>;
  /** Records a repository's last fetch: when, and why it failed (null when it worked). */
  recordFetch(fleetId: FleetId, fetch: { name: string; at: Date; error: string | null }): Promise<void>;
}

/** Outbound port: the catalogue squadrons serves, built at each refresh. */
export interface CatalogueHolder {
  get(): Catalogue;
  set(catalogue: Catalogue): void;
}

/**
 * Outbound port: every tagged template and blueprint version in the
 * configured repositories (docs/squadrons.md, "Files in git").
 */
export interface CatalogueSource {
  files(): Promise<SourceFile[]>;
}
