import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGithubRepositoryReader } from '../src/adapters/github/github-repository-reader.js';
import { assembleCatalogue } from '../src/core/catalogue/assemble-catalogue.js';
import { memberCrewOf } from '../src/core/catalogue/member-crew.js';
import { DEFAULT_PATH } from '../src/core/catalogue/template-repository.js';
import { startFakeGithub, tagsAt, type FakeGithub } from './support/fake-github.js';

// The example set docs/squadrons.md points newcomers to (docs/squadrons-example)
// is valid: tagged <name>@1 in a repository of the name its blueprints
// reference, the GitHub reader and the catalogue read every file of it, and
// leave none out.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const EXAMPLE = fileURLToPath(new URL('../../../docs/squadrons-example', import.meta.url));
const REPOSITORY = { owner: 'tidewater-labs/squadron-templates', name: 'github.com/tidewater-labs/squadron-templates' };

/** Every file of the example set, by its path within the repository. */
function exampleFiles(): Record<string, string> {
  const folder = join(EXAMPLE, DEFAULT_PATH);
  return Object.fromEntries(
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [relative(EXAMPLE, path), readFileSync(path, 'utf8')];
      }),
  );
}

let github: FakeGithub;

beforeEach(async () => {
  github = await startFakeGithub();
});

afterEach(async () => {
  await github.close();
});

describe('the example squadron files', () => {
  it('are read whole, every template and blueprint at version 1, none left out', async () => {
    const files = exampleFiles();
    const names = Object.keys(files).map((path) => path.replace(/^.*\/([^/]+)\.yaml$/, '$1'));
    github.repositories.set(REPOSITORY.owner, { tags: tagsAt({ files }, ...names.map((name) => `${name}@1`)) });

    const { files: read, tags } = await createGithubRepositoryReader({ apiUrl: github.apiUrl }).read(
      [{ fleetId: FLEET, name: REPOSITORY.name, url: `https://${REPOSITORY.name}`, path: DEFAULT_PATH, token: null }],
      { fetch: () => true },
    );
    const catalogue = assembleCatalogue({ repositories: [REPOSITORY.name], files: read, tags });

    expect(catalogue.problems).toEqual([]);
    expect(catalogue.templates.map((template) => `${template.name}@${String(template.version)}`).sort()).toEqual(['implementer@1', 'planner@1', 'reviewer@1', 'tester@1']);
    expect(catalogue.blueprints.map((blueprint) => `${blueprint.name}@${String(blueprint.version)}`).sort()).toEqual(['tidewater-feature@1', 'tidewater-fix@1']);
  });

  it("merge a member's crew settings from its template and its role: tidewater-fix's implementer runs Codex on the template's workspace and labels (#343)", async () => {
    const files = exampleFiles();
    const names = Object.keys(files).map((path) => path.replace(/^.*\/([^/]+)\.yaml$/, '$1'));
    github.repositories.set(REPOSITORY.owner, { tags: tagsAt({ files }, ...names.map((name) => `${name}@1`)) });
    const { files: read, tags } = await createGithubRepositoryReader({ apiUrl: github.apiUrl }).read(
      [{ fleetId: FLEET, name: REPOSITORY.name, url: `https://${REPOSITORY.name}`, path: DEFAULT_PATH, token: null }],
      { fetch: () => true },
    );
    const catalogue = assembleCatalogue({ repositories: [REPOSITORY.name], files: read, tags });
    const role = catalogue.blueprints.find((blueprint) => blueprint.name === 'tidewater-fix')?.roles.find((each) => each.name === 'implementer');
    const template = catalogue.templates.find((each) => each.name === 'implementer');
    if (role === undefined || template === undefined) {
      throw new Error('the example set has no tidewater-fix implementer');
    }

    expect(memberCrewOf({ template, role }).crew).toEqual({
      harness: 'codex',
      workspace: { kind: 'worktree', repository: 'tidewater' },
      options: { effort: 'low', model: 'gpt-6-sol' },
      machineLabels: [{ key: 'os', value: 'linux' }],
    });
  });
});
