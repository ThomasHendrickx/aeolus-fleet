import type { FleetId } from '@aeolus-fleet/common';

import type { Catalogue } from '../../src/core/catalogue/catalogue.js';
import type { CatalogueHolder, RepositoryReader, RepositoryStore, RepositoryToRead, SourceFile, UnreadTag } from '../../src/core/catalogue/ports.js';
import type { TemplateRepository } from '../../src/core/catalogue/template-repository.js';

/** The repository store in memory, one row per fleet and name. */
export function memoryRepositoryStore(): RepositoryStore & { held: TemplateRepository[] } {
  const store: RepositoryStore & { held: TemplateRepository[] } = {
    held: [],
    list: (fleetId: FleetId) => Promise.resolve(store.held.filter((each) => each.fleetId === fleetId).map((each) => structuredClone(each))),
    add: (repository) => {
      if (store.held.some((each) => each.fleetId === repository.fleetId && each.name === repository.name)) {
        return Promise.resolve('taken');
      }
      store.held.push(structuredClone(repository));
      return Promise.resolve('added');
    },
    remove: (fleetId, name) => {
      const before = store.held.length;
      store.held = store.held.filter((each) => !(each.fleetId === fleetId && each.name === name));
      return Promise.resolve(store.held.length < before);
    },
    recordFetch: (fleetId, { name, at, error }) => {
      const held = store.held.find((each) => each.fleetId === fleetId && each.name === name);
      if (held) {
        held.lastFetch = { at, error };
      }
      return Promise.resolve();
    },
  };
  return store;
}

/**
 * Repositories as a fake git: each name holds files, and the version tags
 * read no file at; a name in `failing`
 * cannot be fetched; a repository read without fetching gives what its last
 * fetch gave, and nothing before its first.
 */
export function fakeCatalogueSource(): RepositoryReader & {
  files: Map<string, SourceFile[]>;
  tags: Map<string, UnreadTag[]>;
  failing: Map<string, string>;
  fetches: string[];
  tokens: Map<string, string | null>;
  forgotten: { fleetId: FleetId; url: string }[];
  /** Holds the next read back until the answered function is called. */
  holdNextRead: () => () => void;
} {
  const mirrored = new Map<string, { files: SourceFile[]; tags: UnreadTag[] }>();
  let held: Promise<void> | undefined;
  const source = {
    files: new Map<string, SourceFile[]>(),
    tags: new Map<string, UnreadTag[]>(),
    failing: new Map<string, string>(),
    fetches: new Array<string>(),
    tokens: new Map<string, string | null>(),
    forgotten: new Array<{ fleetId: FleetId; url: string }>(),
    forget: (repository: Pick<RepositoryToRead, 'fleetId' | 'name' | 'url'>) => {
      source.forgotten.push({ fleetId: repository.fleetId, url: repository.url });
      mirrored.delete(repository.name);
      return Promise.resolve();
    },
    holdNextRead: () => {
      let release = (): void => undefined;
      held = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    read: async (repositories: readonly RepositoryToRead[], options: { fetch: (name: string) => boolean }) => {
      const hold = held;
      held = undefined;
      await hold;
      const files: SourceFile[] = [];
      const tags: UnreadTag[] = [];
      const fetched: { name: string; error: string | null }[] = [];
      for (const repository of repositories) {
        if (options.fetch(repository.name)) {
          source.fetches.push(repository.name);
          source.tokens.set(repository.name, repository.token);
          const failure = source.failing.get(repository.name);
          if (failure === undefined) {
            mirrored.set(repository.name, { files: source.files.get(repository.name) ?? [], tags: source.tags.get(repository.name) ?? [] });
          }
          fetched.push({ name: repository.name, error: failure ?? null });
        }
        files.push(...(mirrored.get(repository.name)?.files ?? []));
        tags.push(...(mirrored.get(repository.name)?.tags ?? []));
      }
      return { files, tags, fetched };
    },
  };
  return source;
}

const EMPTY: Catalogue = { templates: [], blueprints: [], problems: [] };

/** The catalogue holder in memory, one catalogue per fleet. */
export function memoryCatalogueHolder(): CatalogueHolder {
  const held = new Map<FleetId, Catalogue>();
  return {
    get: (fleetId) => held.get(fleetId) ?? EMPTY,
    set: (fleetId, catalogue) => {
      held.set(fleetId, catalogue);
    },
  };
}
