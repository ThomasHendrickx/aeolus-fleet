import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// The networking plugin keeps the fleet core's rule, as the trierarch plugin does: its core is
// deterministic, never throws and imports no framework or adapter
// (docs/architecture.md, "The networking plugin").

const coreProbe = 'packages/networking-plugin/src/core/rules-probe.ts';
const adapterProbe = 'packages/networking-plugin/src/adapters/rules-probe.ts';
const lint = createLint({ tsconfig: 'packages/core/tsconfig.json', probes: [coreProbe, adapterProbe] });

const forbidden = [
  { label: 'the clock', code: 'export const now = Date.now();', rule: 'no-restricted-properties' },
  { label: 'a throw', code: "export function refuse(): never {\n  throw new Error('refused');\n}\n", rule: 'no-restricted-syntax' },
  { label: 'an adapter', code: "export { createPrismaClient } from '../adapters/prisma/client.js';", rule: 'no-restricted-imports' },
  { label: 'Fastify', code: "import fastify from 'fastify';\nexport const app = fastify();", rule: 'no-restricted-imports' },
];

describe("the networking plugin's core", () => {
  it.each(forbidden)('refuses $label', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, coreProbe), rule)).toHaveLength(1);
  });

  it.each(forbidden)('allows $label in an adapter', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, adapterProbe), rule)).toEqual([]);
  });
});
