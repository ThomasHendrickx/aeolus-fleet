import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createBlueprintCrew } from './blueprint-crew.js';
import type { BlueprintVersion, Catalogue, TemplateVersion } from './catalogue.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const REPO = 'github.com/tidewater-labs/squadron-templates';
const AT = new Date('2026-10-08T08:00:00.000Z');

function aTemplate(name: string, overrides: Partial<TemplateVersion> = {}): TemplateVersion {
  return {
    repository: REPO,
    name,
    version: 1,
    file: `templates/${name}.yaml`,
    commit: `c-${name}`,
    committedAt: AT,
    description: `${name} template`,
    checkInMinutes: 30,
    model: null,
    launchNote: null,
    charter: `You are the ${name}.`,
    handoffs: [],
    crew: {},
    parameters: [],
    ...overrides,
  };
}

const PLANNER = aTemplate('planner', { model: 'claude-opus-5-5', parameters: [{ name: 'area', description: 'The part the features touch' }] });
const IMPLEMENTER = aTemplate('implementer', { crew: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'tidewater' } } });

const BLUEPRINT: BlueprintVersion = {
  repository: REPO,
  name: 'tidewater-feature',
  version: 1,
  file: 'blueprints/tidewater-feature.yaml',
  commit: 'b1',
  committedAt: AT,
  description: 'A feature team.',
  roles: [
    { name: 'planner', template: { repository: REPO, name: 'planner', version: 1 }, count: 1, model: null, crew: {}, parameters: {} },
    { name: 'implementer', template: { repository: REPO, name: 'implementer', version: 1 }, count: 2, model: null, crew: { options: { effort: 'low' } }, parameters: {} },
  ],
  handoffs: [],
  memberNames: 'plain',
};

function blueprintCrew(catalogue: Catalogue = { templates: [PLANNER, IMPLEMENTER], blueprints: [BLUEPRINT], problems: [] }) {
  return createBlueprintCrew({ catalogue: () => catalogue });
}

describe("a blueprint's member crew settings, to prefill the forming form (#343)", () => {
  it('answers each member by its slot, with its role, its template and its settings merged from template and role', () => {
    const answered = blueprintCrew()(FLEET, { repository: REPO, name: 'tidewater-feature', version: 1 });

    expect(answered).toEqual({
      isOk: true,
      value: [
        {
          slot: 'planner-1',
          role: 'planner',
          template: { repository: REPO, name: 'planner', version: 1 },
          crew: { options: { model: 'claude-opus-5-5' } },
          parameters: [{ name: 'area', description: 'The part the features touch', value: null }],
        },
        ...[1, 2].map((index) => ({
          slot: `implementer-${String(index)}`,
          role: 'implementer',
          template: { repository: REPO, name: 'implementer', version: 1 },
          crew: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'tidewater' }, options: { effort: 'low' } },
          parameters: [],
        })),
      ],
    });
  });

  it('refuses a blueprint version the catalogue does not hold', () => {
    expect(blueprintCrew()(FLEET, { repository: REPO, name: 'tidewater-feature', version: 2 })).toMatchObject({ isOk: false, error: { kind: 'BLUEPRINT_NOT_FOUND' } });
  });

  it("refuses a blueprint one of whose roles' template version the catalogue does not hold", () => {
    const catalogue: Catalogue = { templates: [PLANNER], blueprints: [BLUEPRINT], problems: [] };

    expect(blueprintCrew(catalogue)(FLEET, { repository: REPO, name: 'tidewater-feature', version: 1 })).toMatchObject({ isOk: false, error: { kind: 'BLUEPRINT_NOT_FOUND' } });
  });
});
