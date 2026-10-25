import { idSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import type { Machine } from '../../../lib/trierarch-plugin-schemas';
import { fleetWideChangeOf, modelRowsOf } from './model-rows';

const harness = (name: string, models: string[]) => ({ harness: name, options: { type: 'object', properties: { model: { enum: models } } }, flags: [] });

function aMachine(suffix: string, at: { harnesses: ReturnType<typeof harness>[]; overrides?: Partial<Machine> }): Machine {
  const { harnesses, overrides = {} } = at;
  return {
    shipId: idSchema('ship').parse(`shp_01j9k2t4qzr3a9w6m2v5n7${suffix}`),
    name: `trierarch-${suffix}`,
    status: 'crewed',
    lastSeenAt: '2026-10-25T09:00:00.000Z',
    isSilent: false,
    report: null,
    details: { harnesses, workspaces: { repositories: [], folders: [] }, caps: { ships: 4, running: 0 }, kept: [], orphans: [], version: '0.32.0' },
    ...overrides,
  };
}

const MAC = aMachine('mc01', { harnesses: [harness('claude-code', ['claude-opus-5-5', 'claude-sonnet-5-5']), harness('codex', ['gpt-6'])] });
const MACBOOK = aMachine('mb02', { harnesses: [harness('claude-code', ['claude-opus-5-5'])] });

describe('modelRowsOf', () => {
  it('lists each model a trierarch reports once, with the harnesses that report it and how many machines', () => {
    expect(modelRowsOf([MAC, MACBOOK], [])).toEqual([
      { model: 'claude-opus-5-5', harnesses: ['claude-code'], machineCount: 2, isEnabled: false },
      { model: 'claude-sonnet-5-5', harnesses: ['claude-code'], machineCount: 1, isEnabled: false },
      { model: 'gpt-6', harnesses: ['codex'], machineCount: 1, isEnabled: false },
    ]);
  });

  it('names every harness that reports a model', () => {
    const both = aMachine('bt03', { harnesses: [harness('claude-code', ['shared-model']), harness('codex', ['shared-model'])] });

    expect(modelRowsOf([both], [])).toEqual([{ model: 'shared-model', harnesses: ['claude-code', 'codex'], machineCount: 1, isEnabled: false }]);
  });

  it('marks the enabled models, and lists an enabled model no trierarch reports with no machines', () => {
    expect(modelRowsOf([MACBOOK], ['claude-opus-5-6', 'claude-opus-5-5'])).toEqual([
      { model: 'claude-opus-5-5', harnesses: ['claude-code'], machineCount: 1, isEnabled: true },
      { model: 'claude-opus-5-6', harnesses: [], machineCount: 0, isEnabled: true },
    ]);
  });

  it('counts a silent machine by its last report and leaves out a machine that never reported', () => {
    expect(modelRowsOf([aMachine('st04', { harnesses: [harness('codex', ['gpt-6'])], overrides: { isSilent: true } }), aMachine('nw05', { harnesses: [], overrides: { details: null } })], [])).toEqual([
      { model: 'gpt-6', harnesses: ['codex'], machineCount: 1, isEnabled: false },
    ]);
  });
});

describe('fleetWideChangeOf', () => {
  it('is the first model when the fleet enables none yet', () => {
    expect(fleetWideChangeOf([], { model: 'gpt-6', isEnabled: true })).toBe('first');
  });

  it('is the last model when disabling the only enabled one', () => {
    expect(fleetWideChangeOf(['gpt-6'], { model: 'gpt-6', isEnabled: false })).toBe('last');
  });

  it('is no fleet-wide change while other models stay enabled', () => {
    expect(fleetWideChangeOf(['gpt-6'], { model: 'claude-opus-5-5', isEnabled: true })).toBeUndefined();
    expect(fleetWideChangeOf(['gpt-6', 'claude-opus-5-5'], { model: 'gpt-6', isEnabled: false })).toBeUndefined();
  });
});
