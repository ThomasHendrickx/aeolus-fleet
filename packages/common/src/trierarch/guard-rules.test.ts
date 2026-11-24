import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { guardRuleSetJsonSchema, guardRuleSetSchema, trierarchGuardRulesMessageSchema, TRIERARCH_GUARD_RULES_CONTENT_TYPE } from './guard-rules.js';

// Approved examples from docs/design/guard/README.md, sections 4.1 and 4.4.
const rules = {
  commands: { deny: [{ command: 'npm', args: ['publish'] }, { command: 'curl' }], allow: [] },
  git: { deny: ['push', 'force-push', 'skip-hooks', 'rewrite-history', 'delete-branch', 'change-remote', 'change-config'] },
  writePaths: { allow: ['docs/**'], deny: ['**/.github/**'] },
  tools: { deny: ['web', 'mcp:linear/*'], allow: [] },
};
const set = { name: 'no-push', repository: 'example/guard', commit: 'abc1234', file: 'rules/no-push.yaml', floor: true, rules };
const message = { fleetId: 'flt_01m473j7hp3x6gha0gzs1mnf88', pluginShipId: 'shp_01m473j7hp3x6gha0gzs1mnf88', shipId: 'shp_01m473j7hp3x6gha0gzs1mnf89', settingsVersion: 1, sets: [set] };

describe('shared guard rules', () => {
  it('accepts the approved file and exports the same strict contract as JSON Schema', () => {
    const file = { name: 'no-push', description: 'Never push, never skip hooks.', rules };
    expect(guardRuleSetSchema.parse(file)).toEqual(file);
    expect(guardRuleSetJsonSchema).toEqual(z.toJSONSchema(guardRuleSetSchema));
    expect(guardRuleSetJsonSchema).toMatchObject({ additionalProperties: false, required: ['name'] });
  });

  it('accepts a name-only file and empty rules, which add no policy to the mechanism', () => {
    expect(guardRuleSetSchema.parse({ name: 'base' })).toEqual({ name: 'base' });
    expect(guardRuleSetSchema.parse({ name: 'base', rules: {} })).toEqual({ name: 'base', rules: {} });
  });

  it('carries the inner rules block and pinned provenance with every assignment', () => {
    expect(TRIERARCH_GUARD_RULES_CONTENT_TYPE).toBe('application/vnd.aeolus.trierarch.guard-rules+json');
    expect(trierarchGuardRulesMessageSchema.parse(message)).toEqual(message);
  });

  it('explicitly carries no sets and empty inner rules for a name-only set', () => {
    expect(trierarchGuardRulesMessageSchema.parse({ ...message, sets: [] })).toEqual({ ...message, sets: [] });
    expect(trierarchGuardRulesMessageSchema.parse({ ...message, sets: [{ ...set, rules: {} }] }).sets[0]?.rules).toEqual({});
  });

  it.each([
    { name: 'base', extra: true },
    { name: '../base' },
    { name: 'base', rules: { readPaths: {} } },
    { name: 'base', rules: { commands: { deny: [{ command: 'npm', prefix: 'publish' }] } } },
    { name: 'base', rules: { git: { deny: ['clone'] } } },
    { name: 'base', rules: { tools: { deny: ['unknown-tool'] } } },
  ])('refuses unknown file fields, actions and tool kinds: %j', (file) => {
    expect(guardRuleSetSchema.safeParse(file).success).toBe(false);
  });

  it.each(['/etc/**', '../**', 'docs/../**', 'docs/..', 'C:/system/**', '\\system\\**'])('refuses a write glob outside relative repository paths: %s', (glob) => {
    expect(guardRuleSetSchema.safeParse({ name: 'base', rules: { writePaths: { allow: [glob] } } }).success).toBe(false);
  });

  it.each(['shell', 'file-write', 'file-read', 'web', 'agent', 'mcp:server/tool', 'mcp:*/*'])('accepts the harness-neutral tool %s', (tool) => {
    expect(guardRuleSetSchema.safeParse({ name: 'base', rules: { tools: { allow: [tool] } } }).success).toBe(true);
  });

  it.each([
    { ...message, settingsVersion: 0 },
    { ...message, settingsVersion: 1.5 },
    { ...message, fleetId: message.shipId },
    { ...message, pluginShipId: message.fleetId },
    { ...message, shipId: 'lookout' },
    { ...message, token: 'not-a-credential' },
    { ...message, sets: [{ ...set, floor: undefined }] },
    { ...message, sets: [{ ...set, rules: { name: 'no-push', rules } }] },
  ])('refuses malformed assignment messages: %j', (input) => {
    expect(trierarchGuardRulesMessageSchema.safeParse(input).success).toBe(false);
  });
});
