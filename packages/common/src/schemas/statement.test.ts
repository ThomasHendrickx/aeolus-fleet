import { describe, expect, it } from 'vitest';

import { idSchema } from '../ids/index.js';
import {
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
