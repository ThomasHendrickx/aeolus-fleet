import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// core/src/domain imports no framework, database or adapter (CLAUDE.md,
// "Architecture rules").

const coreProbe = 'packages/core/src/domain/shared/boundary-probe.ts';
const unlistedCoreProbe = 'packages/core/src/domain/boundary-probe.ts';
const adapterProbe = 'packages/core/src/adapters/prisma/boundary-probe.ts';
const lint = createLint({
  tsconfig: 'packages/core/tsconfig.json',
  probes: [coreProbe, unlistedCoreProbe, adapterProbe],
});

async function boundaryViolations(code: string, path: string): Promise<string[]> {
  const messages = await lint(code, path);
  return [...reportsOf(messages, 'no-restricted-imports'), ...reportsOf(messages, 'no-restricted-syntax')];
}

describe('core import boundary', () => {
  it.each([
    ['the Prisma client', "import { PrismaClient } from '@prisma/client';"],
    ['the Prisma pg adapter', "import { PrismaPg } from '@prisma/adapter-pg';"],
    ['the Prisma config', "import { defineConfig } from 'prisma/config';"],
    ['a Prisma type only', "import type { PrismaClient } from '@prisma/client';"],
    ['pg', "import pg from 'pg';"],
    ['Fastify', "import Fastify from 'fastify';"],
    ['a Fastify plugin', "import cors from '@fastify/cors';"],
    ['the tRPC server', "import { initTRPC } from '@trpc/server';"],
    ['an adapter by relative path', "import { createPrismaClient } from '../../adapters/prisma/client.js';"],
    ['the generated Prisma client', "import { PrismaClient } from '../../adapters/prisma/generated/client.js';"],
    ['the core package entry', "import type { AppRouter } from '@aeolus-fleet/core';"],
    ['a re-export of Prisma', "export { PrismaClient } from '@prisma/client';"],
    ['Prisma through import()', "export const load = () => import('@prisma/client');"],
    ['Prisma through an import type', "export type Client = import('@prisma/client').PrismaClient;"],
  ])('fails when core imports %s', async (_label, code) => {
    const violations = await boundaryViolations(code, coreProbe);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('core/src/domain must not import ');
  });

  it('fails when a core file outside the context folders imports Prisma', async () => {
    const violations = await boundaryViolations("import { PrismaClient } from '@prisma/client';", unlistedCoreProbe);

    expect(violations).toEqual([expect.stringContaining('must not import Prisma')]);
  });

  it('names Prisma in the failure', async () => {
    const violations = await boundaryViolations("import { PrismaClient } from '@prisma/client';", coreProbe);

    expect(violations).toEqual([expect.stringContaining('must not import Prisma')]);
  });

  it.each([
    ['another core module', "import type { Clock } from './clock.js';"],
    ['common', "import { createIdGenerator } from '@aeolus-fleet/common';"],
    ['a Node built-in', "import { inspect } from 'node:util';"],
    ['a package whose name only starts like pg', "import pgp from 'pgp';"],
  ])('allows core to import %s', async (_label, code) => {
    await expect(boundaryViolations(code, coreProbe)).resolves.toEqual([]);
  });

  it('allows adapters to import Prisma', async () => {
    const violations = await boundaryViolations("import { PrismaClient } from '@prisma/client';", adapterProbe);

    expect(violations).toEqual([]);
  });
});
