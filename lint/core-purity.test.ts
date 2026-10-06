import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// core/src/domain is deterministic and never throws: time, randomness and
// hashing reach it through ports, and a refusal is a result (domain-modelling
// and typescript skills).

const coreProbe = 'packages/core/src/domain/shared/purity-probe.ts';
const coreTestProbe = 'packages/core/src/domain/registry/purity-probe.test.ts';
// A file in core but in none of the context folders, such as a new one.
const unlistedCoreProbe = 'packages/core/src/domain/purity-probe.ts';
const adapterProbe = 'packages/core/src/adapters/http/purity-probe.ts';
const lint = createLint({
  tsconfig: 'packages/core/tsconfig.json',
  probes: [coreProbe, coreTestProbe, unlistedCoreProbe, adapterProbe],
});

const impurities = [
  { label: 'Date.now()', code: 'export const now = Date.now();', rule: 'no-restricted-properties', says: 'never reads the clock' },
  { label: 'new Date()', code: 'export const now = new Date();', rule: 'no-restricted-syntax', says: 'never reads the clock' },
  { label: 'Date()', code: 'export const now = Date();', rule: 'no-restricted-syntax', says: 'never reads the clock' },
  { label: 'Math.random()', code: 'export const roll = Math.random();', rule: 'no-restricted-properties', says: 'never makes randomness' },
  { label: 'the crypto global', code: 'export const id = crypto.randomUUID();', rule: 'no-restricted-globals', says: 'never uses crypto' },
  {
    label: 'globalThis.crypto',
    code: 'export const id = globalThis.crypto.randomUUID();',
    rule: 'no-restricted-properties',
    says: 'never uses crypto',
  },
  {
    label: 'node:crypto',
    code: "import { randomBytes } from 'node:crypto';\nexport const token = randomBytes(32);",
    rule: 'no-restricted-imports',
    says: 'never uses crypto',
  },
  {
    label: 'crypto',
    code: "import { createHash } from 'crypto';\nexport const hash = createHash('sha256');",
    rule: 'no-restricted-imports',
    says: 'never uses crypto',
  },
];

describe('the core is deterministic', () => {
  it.each(impurities)('refuses $label', async ({ code, rule, says }) => {
    expect(reportsOf(await lint(code, coreProbe), rule)).toEqual([expect.stringContaining(`core/src/domain ${says}`)]);
  });

  it.each(impurities)('refuses $label in a core test too', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, coreTestProbe), rule)).toHaveLength(1);
  });

  it.each(impurities)('refuses $label in a core file outside the context folders', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, unlistedCoreProbe), rule)).toHaveLength(1);
  });

  it('allows a date built from a time it was given', async () => {
    const messages = await lint('export const later = (at: Date) => new Date(at.getTime() + 1);', coreProbe);

    expect(reportsOf(messages, 'no-restricted-syntax')).toEqual([]);
  });

  it.each(impurities)('allows $label in an adapter', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, adapterProbe), rule)).toEqual([]);
  });
});

describe('the core never throws', () => {
  const throwing = "export function refuse(): never {\n  throw new Error('refused');\n}\n";

  it('refuses a throw', async () => {
    expect(reportsOf(await lint(throwing, coreProbe), 'no-restricted-syntax')).toEqual([
      expect.stringContaining('core/src/domain never throws: return a Result'),
    ]);
  });

  it('refuses a throw in a core test too', async () => {
    expect(reportsOf(await lint(throwing, coreTestProbe), 'no-restricted-syntax')).toHaveLength(1);
  });

  it('refuses a throw in a core file outside the context folders', async () => {
    expect(reportsOf(await lint(throwing, unlistedCoreProbe), 'no-restricted-syntax')).toHaveLength(1);
  });

  it('allows an adapter to throw, for system failures', async () => {
    expect(reportsOf(await lint(throwing, adapterProbe), 'no-restricted-syntax')).toEqual([]);
  });
});
