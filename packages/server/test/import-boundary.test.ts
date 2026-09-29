import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// Lints source text as if it lived at the given path, with the repository's real
// ESLint config, so this proves the rule that runs in CI. The probe files do not
// exist on disk, so the only override lets the TypeScript project service type
// them with the server's tsconfig.
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const coreProbe = 'packages/server/src/core/shared/boundary-probe.ts';
const adapterProbe = 'packages/server/src/adapters/prisma/boundary-probe.ts';
const coreFile = `${repositoryRoot}${coreProbe}`;
const adapterFile = `${repositoryRoot}${adapterProbe}`;

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: repositoryRoot,
    overrideConfig: {
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: [coreProbe, adapterProbe],
            defaultProject: 'packages/server/tsconfig.json',
          },
        },
      },
    },
  });
});

async function boundaryViolations(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  const messages = result?.messages ?? [];
  const fatal = messages.find((message) => message.fatal === true);
  if (fatal) {
    throw new Error(`ESLint could not parse the probe: ${fatal.message}`);
  }
  return messages
    .filter((message) => message.ruleId === 'no-restricted-imports' || message.ruleId === 'no-restricted-syntax')
    .map((message) => message.message);
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
    const violations = await boundaryViolations(code, coreFile);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('server/src/core must not import ');
  });

  it('names Prisma in the failure', async () => {
    const violations = await boundaryViolations("import { PrismaClient } from '@prisma/client';", coreFile);

    expect(violations).toEqual([expect.stringContaining('must not import Prisma')]);
  });

  it.each([
    ['another core module', "import type { Clock } from './clock.js';"],
    ['common', "import { createIdGenerator } from '@aeolus-fleet/common';"],
    ['a Node built-in', "import { randomBytes } from 'node:crypto';"],
    ['a package whose name only starts like pg', "import pgp from 'pgp';"],
  ])('allows core to import %s', async (_label, code) => {
    await expect(boundaryViolations(code, coreFile)).resolves.toEqual([]);
  });

  it('allows adapters to import Prisma', async () => {
    const violations = await boundaryViolations("import { PrismaClient } from '@prisma/client';", adapterFile);

    expect(violations).toEqual([]);
  });
});
