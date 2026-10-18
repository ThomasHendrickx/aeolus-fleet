import { describe, expect, it } from 'vitest';

import { idSchema } from '../ids/index.js';
import {
  CAPABILITY_DEADLINE_MAX_MS,
  CAPABILITY_WAIT_MAX_MS,
  STATEMENT_MAX_BYTES,
  STATEMENT_SUMMARY_MAX_LENGTH,
  discoverOutputSchema,
  setStatementInputSchema,
  setStatementOutputSchema,
  statementBytes,
} from './statement.js';

const REVIEW = {
  name: 'review_pr',
  title: 'Review a pull request',
  description: 'Reviews a pull request against its acceptance criteria and answers the findings.',
  inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  outputSchema: { type: 'object', properties: { findings: { type: 'array' } } },
  inputModes: ['text/plain', 'application/json'],
  outputModes: ['text/markdown'],
};

describe('setStatementInputSchema (decision 0047)', () => {
  it('takes a summary and capabilities with MCP tool fields and A2A media types', () => {
    const statement = { summary: 'Reviews pull requests of aeolus-fleet.', capabilities: [REVIEW] };

    expect(setStatementInputSchema.parse(statement)).toEqual(statement);
  });

  it('takes a capability with its name only, and no capabilities at all', () => {
    expect(setStatementInputSchema.parse({ summary: 'A planner.', capabilities: [{ name: 'plan' }] })).toEqual({ summary: 'A planner.', capabilities: [{ name: 'plan' }] });
    expect(setStatementInputSchema.parse({ summary: 'A planner.', capabilities: [] })).toEqual({ summary: 'A planner.', capabilities: [] });
  });

  it('trims the summary', () => {
    expect(setStatementInputSchema.parse({ summary: '  A planner.  ', capabilities: [] }).summary).toBe('A planner.');
  });

  it(`takes a summary of ${String(STATEMENT_SUMMARY_MAX_LENGTH)} characters, and refuses one more`, () => {
    expect(setStatementInputSchema.safeParse({ summary: 'x'.repeat(STATEMENT_SUMMARY_MAX_LENGTH), capabilities: [] }).success).toBe(true);
    expect(setStatementInputSchema.safeParse({ summary: 'x'.repeat(STATEMENT_SUMMARY_MAX_LENGTH + 1), capabilities: [] }).success).toBe(false);
  });

  it.each([
    ['no summary', { capabilities: [] }],
    ['an empty summary', { summary: '   ', capabilities: [] }],
    ['no capabilities', { summary: 'A planner.' }],
    ['a capability without a name', { summary: 'A planner.', capabilities: [{ title: 'Plan' }] }],
    ['a name with a space, which MCP refuses', { summary: 'A planner.', capabilities: [{ name: 'make plan' }] }],
    ['a name over 128 characters', { summary: 'A planner.', capabilities: [{ name: 'x'.repeat(129) }] }],
    ['two capabilities of one name', { summary: 'A planner.', capabilities: [{ name: 'plan' }, { name: 'plan' }] }],
    ['an input schema that is not an object', { summary: 'A planner.', capabilities: [{ name: 'plan', inputSchema: 'string' }] }],
    ['no media type in its input modes', { summary: 'A planner.', capabilities: [{ name: 'plan', inputModes: [] }] }],
    ['an output mode that is no media type', { summary: 'A planner.', capabilities: [{ name: 'plan', outputModes: ['markdown'] }] }],
    ['a field of its own', { summary: 'A planner.', capabilities: [{ name: 'plan', cost: 3 }] }],
  ])('refuses %s', (_label, input) => {
    expect(setStatementInputSchema.safeParse(input).success).toBe(false);
  });

  it('refuses a statement over 64 KB as the UTF-8 bytes of its JSON, and takes one at exactly that', () => {
    const fill = (bytes: number) => {
      const base = { summary: 'A planner.', capabilities: [{ name: 'plan', description: '' }] };
      return { ...base, capabilities: [{ name: 'plan', description: 'x'.repeat(bytes - statementBytes(base)) }] };
    };

    expect(statementBytes(fill(STATEMENT_MAX_BYTES))).toBe(64 * 1024);
    expect(setStatementInputSchema.safeParse(fill(STATEMENT_MAX_BYTES)).success).toBe(true);
    expect(setStatementInputSchema.safeParse(fill(STATEMENT_MAX_BYTES + 1)).success).toBe(false);
  });
});

describe('what a capability states for a call through the gateway (interop 3.4, 5.2, 5.3)', () => {
  const withCapability = (capability: Record<string, unknown>) => ({ summary: 'The CRM.', capabilities: [{ name: 'lookup_account', ...capability }] });

  it("takes a wait, a deadline, a repeatable mark and MCP's tool annotations", () => {
    const statement = withCapability({
      waitMs: 2000,
      deadlineMs: 60_000,
      repeatable: true,
      annotations: { title: 'Look up an account', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    });

    expect(setStatementInputSchema.parse(statement)).toEqual(statement);
  });

  it('leaves each of them out unless stated: no wait, no deadline, not repeatable', () => {
    expect(setStatementInputSchema.parse(withCapability({})).capabilities[0]).toEqual({ name: 'lookup_account' });
  });

  it('takes a wait of 0 and of 2 minutes, and refuses one more millisecond', () => {
    expect(CAPABILITY_WAIT_MAX_MS).toBe(120_000);
    expect(setStatementInputSchema.safeParse(withCapability({ waitMs: 0 })).success).toBe(true);
    expect(setStatementInputSchema.safeParse(withCapability({ waitMs: 120_000 })).success).toBe(true);
    expect(setStatementInputSchema.safeParse(withCapability({ waitMs: 120_001 })).success).toBe(false);
  });

  it('takes a deadline of 1 millisecond and of 7 days, and refuses one more millisecond', () => {
    expect(CAPABILITY_DEADLINE_MAX_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(setStatementInputSchema.safeParse(withCapability({ deadlineMs: 1 })).success).toBe(true);
    expect(setStatementInputSchema.safeParse(withCapability({ deadlineMs: 604_800_000 })).success).toBe(true);
    expect(setStatementInputSchema.safeParse(withCapability({ deadlineMs: 604_800_001 })).success).toBe(false);
  });

  it.each([
    ['a negative wait', { waitMs: -1 }],
    ['a wait that is a fraction', { waitMs: 1.5 }],
    ['a deadline of 0', { deadlineMs: 0 }],
    ['a deadline that is a fraction', { deadlineMs: 1000.5 }],
    ['a repeatable mark that is no boolean', { repeatable: 'yes' }],
    ['an annotation hint that is no boolean', { annotations: { readOnlyHint: 'true' } }],
    ['an annotation MCP does not define', { annotations: { costHint: 3 } }],
  ])('refuses %s', (_label, capability) => {
    expect(setStatementInputSchema.safeParse(withCapability(capability)).success).toBe(false);
  });
});

describe('setStatementOutputSchema', () => {
  it("answers the statement's version", () => {
    expect(setStatementOutputSchema.parse({ version: 2 })).toEqual({ version: 2 });
  });
});

describe('discoverOutputSchema (decision 0047)', () => {
  it("answers each ship with its statement, the crew's or the commission note, and each type with how many of its ships it reaches", () => {
    const answer = {
      ships: [
        { id: idSchema('ship').parse('shp_01m56nef0v036d0tne8wwnddth'), name: 'reviewer', type: 'reviewer', kind: 'agent', status: 'crewed', statement: { by: 'crew', version: 1, summary: 'Reviews.', capabilities: [REVIEW] } },
        { id: idSchema('ship').parse('shp_01m56nef0v036d0tne8wwnddtj'), name: 'planner', type: 'planner', kind: 'agent', status: 'awaitingCrew', statement: { by: 'commission', note: 'Plans the slices' } },
        { id: idSchema('ship').parse('shp_01m56nef0v036d0tne8wwnddtk'), name: 'alice', type: 'person', kind: 'person', status: 'awaitingCrew', statement: null },
      ],
      types: [{ type: 'reviewer', reachable: 1 }],
    };

    expect(discoverOutputSchema.parse(answer)).toEqual(answer);
  });
});
