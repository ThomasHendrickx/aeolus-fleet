import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// Prisma and pg live in the Prisma adapter only; REST and MCP reach the core
// only through the tRPC router (CLAUDE.md, "Architecture rules"; ADR 0004).

const server = {
  prisma: 'packages/server/src/adapters/prisma/boundary-probe.ts',
  http: 'packages/server/src/adapters/http/boundary-probe.ts',
  rest: 'packages/server/src/adapters/rest/boundary-probe.ts',
  mcp: 'packages/server/src/adapters/mcp/boundary-probe.ts',
  test: 'packages/server/test/boundary-probe.ts',
};
const web = 'packages/web/lib/boundary-probe.ts';
const root = { script: 'scripts/boundary-probe.ts', e2e: 'e2e/boundary-probe.ts' };

// Import rules need no package-specific typing, so every probe is typed with the server's tsconfig.
const lint = createLint({
  tsconfig: 'packages/server/tsconfig.json',
  probes: [...Object.values(server), web, ...Object.values(root)],
});

async function importViolations(messages: Promise<Parameters<typeof reportsOf>[0]>): Promise<string[]> {
  const reported = await messages;
  return [...reportsOf(reported, 'no-restricted-imports'), ...reportsOf(reported, 'no-restricted-syntax')];
}

const databaseImports = [
  { label: 'the Prisma client', code: "import { PrismaClient } from '@prisma/client';" },
  { label: 'the Prisma pg adapter', code: "import { PrismaPg } from '@prisma/adapter-pg';" },
  { label: 'pg', code: "import pg from 'pg';" },
  { label: 'a pg package', code: "import Pool from 'pg-pool';" },
];

describe('Prisma and pg outside the Prisma adapter', () => {
  it.each(databaseImports)('refuses $label in another adapter', async ({ code }) => {
    await expect(importViolations(lint(code, server.http))).resolves.toEqual([
      expect.stringMatching(/is imported only in server\/src\/adapters\/prisma/),
    ]);
  });

  it.each(databaseImports)('refuses $label in a server test', async ({ code }) => {
    await expect(importViolations(lint(code, server.test))).resolves.toHaveLength(1);
  });

  it.each(databaseImports)('refuses $label in the web app', async ({ code }) => {
    await expect(importViolations(lint(code, web))).resolves.toHaveLength(1);
  });

  it.each(databaseImports)('refuses $label in scripts and end-to-end tests', async ({ code }) => {
    await expect(importViolations(lint(code, root.script))).resolves.toHaveLength(1);
    await expect(importViolations(lint(code, root.e2e))).resolves.toHaveLength(1);
  });

  it.each(databaseImports)('allows $label in the Prisma adapter', async ({ code }) => {
    await expect(importViolations(lint(code, server.prisma))).resolves.toEqual([]);
  });

  it('allows the Prisma adapter itself everywhere else', async () => {
    const code = "import { createPrismaClient } from '../src/adapters/prisma/client.js';";

    await expect(importViolations(lint(code, server.test))).resolves.toEqual([]);
  });
});

describe('REST and MCP go through the tRPC router', () => {
  it.each([
    { label: 'a use case', code: "import { createSignIn } from '../../core/identity/sign-in.js';" },
    { label: 'a core type', code: "import type { Caller } from '../../core/shared/caller.js';" },
    { label: 'the core with import()', code: "export const load = () => import('../../core/identity/sign-in.js');" },
  ])('refuses $label in REST and in MCP', async ({ code }) => {
    for (const door of [server.rest, server.mcp]) {
      await expect(importViolations(lint(code, door))).resolves.toEqual([
        expect.stringContaining('adapters/rest and adapters/mcp never import core'),
      ]);
    }
  });

  it('refuses Prisma in REST and in MCP too', async () => {
    await expect(importViolations(lint("import pg from 'pg';", server.rest))).resolves.toHaveLength(1);
    await expect(importViolations(lint("import pg from 'pg';", server.mcp))).resolves.toHaveLength(1);
  });

  it('allows REST and MCP the tRPC router', async () => {
    const code = "import { appRouter } from '../trpc/router.js';";

    await expect(importViolations(lint(code, server.rest))).resolves.toEqual([]);
    await expect(importViolations(lint(code, server.mcp))).resolves.toEqual([]);
  });

  it('allows other adapters the core', async () => {
    const code = "import { createSignIn } from '../../core/identity/sign-in.js';";

    await expect(importViolations(lint(code, server.http))).resolves.toEqual([]);
  });
});
