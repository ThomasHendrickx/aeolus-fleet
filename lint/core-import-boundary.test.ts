import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// server/src/core imports no framework, database or adapter (CLAUDE.md,
// "Architecture rules").

const coreProbe = 'packages/server/src/core/shared/boundary-probe.ts';
const adapterProbe = 'packages/server/src/adapters/prisma/boundary-probe.ts';
const lint = createLint({ tsconfig: 'packages/server/tsconfig.json', probes: [coreProbe, adapterProbe] });

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
    ['the server package entry', "import type { AppRouter } from '@aeolus-fleet/server';"],
    ['a re-export of Prisma', "export { PrismaClient } from '@prisma/client';"],
    ['Prisma through import()', "export const load = () => import('@prisma/client');"],
    ['Prisma through an import type', "export type Client = import('@prisma/client').PrismaClient;"],
  ])('fails when core imports %s', async (_label, code) => {
    const violations = await boundaryViolations(code, coreProbe);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('server/src/core must not import ');
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
