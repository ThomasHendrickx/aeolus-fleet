import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { runServerCommand } from './support/commands.js';
import { FLEET_URL, OPERATOR } from './support/core-fixtures.js';
import { createMigratedDatabase } from './support/database.js';
import { unwrap } from './support/result.js';

// The two server commands, run exactly as the operator runs them: through npm,
// from the repository root, against a real Postgres.

let databaseUrl: string;
let database: PrismaClient;
let useCases: UseCases;

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, fleetUrl: FLEET_URL });
});

afterAll(async () => {
  await database.$disconnect();
});

function run(script: string, options: { args?: string[]; answers?: string[] } = {}) {
  return runServerCommand({ script, ...options, env: { DATABASE_URL: databaseUrl, PUBLIC_URL: FLEET_URL } });
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

  it('fleet:init asks for the operator email and password, and creates the fleet, argo and the account', async () => {
    const result = await run('fleet:init', {
      args: ['--name', 'home fleet'],
      answers: [OPERATOR.email, OPERATOR.password, OPERATOR.password],
    });

    expect(result.code).toBe(0);
    firstSecret = secretIn(result.stdout);
    await expect(database.fleet.findMany()).resolves.toEqual([expect.objectContaining({ name: 'home fleet' })]);
    await expect(database.operator.findMany()).resolves.toEqual([expect.objectContaining({ email: OPERATOR.email })]);
    expect(result.stdout).not.toContain(OPERATOR.password);
    await expect(useCases.signIn(OPERATOR)).resolves.toMatchObject({
      isOk: true,
      value: { caller: { kind: 'operator' } },
    });
  });

  it('fleet:init refuses a second run', async () => {
    const result = await run('fleet:init', {
      args: ['--name', 'second fleet'],
      answers: ['second@example.com', OPERATOR.password, OPERATOR.password],
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('A fleet already exists');
    expect(result.stdout).not.toMatch(/aeolus_sk_v1_/);
    await expect(database.fleet.count()).resolves.toBe(1);
    await expect(database.operator.count()).resolves.toBe(1);
  });

  it('argo:replace-secret makes the old secret fail, ends the sessions and prints a new one', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));

    const result = await run('argo:replace-secret');

    expect(result.code).toBe(0);
    const newSecret = secretIn(result.stdout);
    expect(newSecret).not.toBe(firstSecret);
    await expect(useCases.authenticate.bySecret(firstSecret)).resolves.toBeUndefined();
    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    await expect(useCases.authenticate.bySecret(newSecret)).resolves.toMatchObject({ kind: 'operator' });
  });
});
