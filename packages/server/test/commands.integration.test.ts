import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { createMigratedDatabase } from './support/database.js';

// The two server commands, run exactly as the operator runs them: through npm,
// from the repository root, against a real Postgres.

const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));

let databaseUrl: string;
let database: PrismaClient;
let useCases: UseCases;

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database });
});

afterAll(async () => {
  await database.$disconnect();
});

async function npmRun(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run('npm', ['run', '--silent', ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

function secretIn(output: string): string {
  const match = /aeolus_sk_v1_[A-Za-z0-9_-]{43}/.exec(output);
  if (!match) {
    throw new Error(`no secret in: ${output}`);
  }
  return match[0];
}

describe('the server commands', () => {
  let firstSecret: string;

  it("fleet:init creates the fleet and argo, and prints argo's secret", async () => {
    const result = await npmRun('fleet:init', '-w', '@aeolus-fleet/server', '--', '--name', 'home fleet');

    expect(result.code).toBe(0);
    firstSecret = secretIn(result.stdout);
    await expect(database.fleet.findMany()).resolves.toEqual([expect.objectContaining({ name: 'home fleet' })]);
    await expect(useCases.signIn({ secret: firstSecret })).resolves.toMatchObject({ caller: { kind: 'operator' } });
  });

  it('fleet:init refuses a second run', async () => {
    const result = await npmRun('fleet:init', '-w', '@aeolus-fleet/server', '--', '--name', 'second fleet');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('A fleet already exists');
    expect(result.stdout).not.toMatch(/aeolus_sk_v1_/);
    await expect(database.fleet.count()).resolves.toBe(1);
  });

  it('argo:replace-secret makes the old secret fail, ends the sessions and prints a new one', async () => {
    const { token } = await useCases.signIn({ secret: firstSecret });

    const result = await npmRun('argo:replace-secret', '-w', '@aeolus-fleet/server');

    expect(result.code).toBe(0);
    const newSecret = secretIn(result.stdout);
    expect(newSecret).not.toBe(firstSecret);
    await expect(useCases.signIn({ secret: firstSecret })).rejects.toMatchObject({ code: 'INVALID_SECRET' });
    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    await expect(useCases.signIn({ secret: newSecret })).resolves.toMatchObject({ caller: { kind: 'operator' } });
  });
});
