import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  describedAnswerSchema,
  FIRST_PROMPT_MAX_BYTES,
  listedAnswerSchema,
  trierarchAnswerSchemas,
  trierarchCommandSchemas,
  trierarchContentType,
  trierarchNoticeSchemas,
  wantCommandSchema,
} from './protocol.js';

/** Every example in docs/trierarch.md, labelled with its name and role: ```json want command. */
function examplesInTheDocs(): { name: string; role: string; payload: unknown }[] {
  const docs = readFileSync(new URL('../../../../docs/trierarch.md', import.meta.url), 'utf8');
  return [...docs.matchAll(/```json (\w+) (command|answer|notice)\n([\s\S]*?)```/g)].map(([, name = '', role = '', json = '']) => {
    const payload: unknown = JSON.parse(json);
    return { name, role, payload };
  });
}

const SCHEMAS_BY_ROLE: Record<string, Record<string, z.ZodType>> = {
  command: trierarchCommandSchemas,
  answer: trierarchAnswerSchemas,
  notice: trierarchNoticeSchemas,
};

const SHIP_ID = 'shp_01m473j7hp3x6gha0gzs1mnf88';
const aWant = { shipId: SHIP_ID, harness: 'claude-code', workspace: { kind: 'folder', name: 'notes' }, options: {} };

describe('the trierarch protocol', () => {
  it('takes every example in docs/trierarch.md', () => {
    const examples = examplesInTheDocs();

    expect(examples.length).toBeGreaterThanOrEqual(13);
    for (const { name, role, payload } of examples) {
      const schema = SCHEMAS_BY_ROLE[role]?.[name];
      expect(schema, `${role} ${name}`).toBeDefined();
      expect(schema?.safeParse(payload).error, `${role} ${name}`).toBeUndefined();
    }
  });

  it('has an example of every command, answer and notice', () => {
    const examples = new Set(examplesInTheDocs().map(({ name, role }) => `${role} ${name}`));

    for (const [role, schemas] of Object.entries(SCHEMAS_BY_ROLE)) {
      for (const name of Object.keys(schemas)) {
        expect(examples, `${role} ${name}`).toContain(`${role} ${name}`);
      }
    }
  });

  it('names its content types by convention', () => {
    expect(trierarchContentType('want')).toBe('application/vnd.aeolus.trierarch.want+json');
  });

  it.each([
    ['describe', {}],
    ['want', aWant],
    ['release', { shipId: SHIP_ID }],
    ['list', {}],
  ])('refuses an unknown field in the %s command', (name, payload) => {
    expect(trierarchCommandSchemas[name]?.safeParse({ ...payload, path: '/tmp' }).success).toBe(false);
  });

  it.each([
    ['wanted', { shipId: SHIP_ID }],
    ['released', { shipId: SHIP_ID, workspace: 'removed' }],
    ['listed', { ships: [], kept: [], orphans: [] }],
  ])('refuses an unknown field in the %s answer', (name, payload) => {
    expect(trierarchAnswerSchemas[name]?.safeParse({ ...payload, extra: true }).success).toBe(false);
  });

  it.each([
    ['running', { shipId: SHIP_ID }],
    ['crashed', { shipId: SHIP_ID, exits: 5 }],
    ['leaseEnded', { shipId: SHIP_ID }],
  ])('refuses an unknown field in the %s notice', (name, payload) => {
    expect(trierarchNoticeSchemas[name]?.safeParse({ ...payload, extra: true }).success).toBe(false);
  });
});

describe('a described answer', () => {
  const aDescribed = (adapterFlags: unknown) => ({
    harnesses: [{ harness: 'codex', options: { type: 'object', properties: {}, additionalProperties: false }, flags: [], adapterFlags }],
    workspaces: { repositories: [], folders: [] },
    caps: { ships: 1, running: 1 },
    kept: [],
    version: '0.18.0',
  });

  it('gives the flags each adapter adds itself, always or on a restart, beside the configured ones', () => {
    expect(describedAnswerSchema.safeParse(aDescribed([{ flag: '--no-daemon', when: 'always' }])).success).toBe(true);
    expect(describedAnswerSchema.safeParse(aDescribed([{ flag: '--continue', when: 'restart' }])).success).toBe(true);
  });

  it('refuses an adapter flag added at any other time', () => {
    expect(describedAnswerSchema.safeParse(aDescribed([{ flag: '--continue', when: 'sometimes' }])).success).toBe(false);
  });
});

describe('a want', () => {
  it('takes a squadron, the id of the squadron the ship is a member of', () => {
    expect(wantCommandSchema.parse({ ...aWant, squadron: 'hemma-feature-a1b2c3' }).squadron).toBe('hemma-feature-a1b2c3');
  });

  it('takes no squadron, for a ship in none', () => {
    expect(wantCommandSchema.parse(aWant).squadron).toBeUndefined();
  });

  it('refuses a squadron that is no squadron id', () => {
    expect(wantCommandSchema.safeParse({ ...aWant, squadron: 'Hemma Feature' }).success).toBe(false);
  });

  it.each([
    ['a path for a folder', { kind: 'folder', name: '/Users/thomas/notes' }],
    ['a path for a repository', { kind: 'worktree', repository: '../aeolus-fleet' }],
    ['a path beside a name', { kind: 'folder', name: 'notes', path: '/Users/thomas/notes' }],
    ['an unknown kind', { kind: 'clone', repository: 'aeolus-fleet' }],
  ])('refuses %s in its workspace, which names what the configuration holds', (_label, workspace) => {
    expect(wantCommandSchema.safeParse({ ...aWant, workspace }).success).toBe(false);
  });

  it('takes a first prompt of exactly 8 KB', () => {
    const firstPrompt = 'a'.repeat(FIRST_PROMPT_MAX_BYTES);

    expect(wantCommandSchema.parse({ ...aWant, firstPrompt }).firstPrompt).toBe(firstPrompt);
  });

  it('refuses a first prompt one byte over 8 KB, counted in UTF-8', () => {
    const firstPrompt = `${'a'.repeat(FIRST_PROMPT_MAX_BYTES - 1)}é`;

    expect(wantCommandSchema.safeParse({ ...aWant, firstPrompt }).success).toBe(false);
  });

  it('refuses a want without options; no options is an empty object', () => {
    const withoutOptions = { shipId: aWant.shipId, harness: aWant.harness, workspace: aWant.workspace };

    expect(wantCommandSchema.safeParse(withoutOptions).success).toBe(false);
  });
});

describe('the listed answer', () => {
  it('refuses a ship in a state no entry has', () => {
    const ship = { shipId: SHIP_ID, harness: 'claude-code', state: 'sleeping', since: '2026-10-06T08:00:00.000Z', restarts: 0 };

    expect(listedAnswerSchema.safeParse({ ships: [ship], kept: [], orphans: [] }).success).toBe(false);
  });
});
