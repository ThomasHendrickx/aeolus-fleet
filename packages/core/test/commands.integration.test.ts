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
  useCases = createUseCases({ prisma: database });
});

afterAll(async () => {
  await database.$disconnect();
});

function run(script: string, options: { args?: string[]; answers?: string[] } = {}) {
  return runServerCommand({ script, ...options, env: { DATABASE_URL: databaseUrl, PUBLIC_URL: FLEET_URL } });
}

const NEW_PASSWORD = 'staple battery horse correct';

describe('the server commands', () => {
  it('fleet:init asks for the operator email and password, and creates the fleet, argo without a secret and the account', async () => {
    const result = await run('fleet:init', {
      args: ['--name', 'home fleet'],
      answers: [OPERATOR.email, OPERATOR.password, OPERATOR.password],
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Operator account: opr_');
    expect(result.stdout).not.toMatch(/aeolus_sk_v1_/);
    await expect(database.credential.count()).resolves.toBe(0);
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

  it('operator:reset-password asks for a new password, ends the sessions, and the old password stops working', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));

    const result = await run('operator:reset-password', { answers: [NEW_PASSWORD, NEW_PASSWORD] });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Every console session has ended');
    expect(result.stdout).not.toContain(NEW_PASSWORD);
    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    await expect(useCases.signIn(OPERATOR)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'WRONG_EMAIL_OR_PASSWORD' },
    });
    await expect(useCases.signIn({ email: OPERATOR.email, password: NEW_PASSWORD })).resolves.toMatchObject({
      isOk: true,
      value: { caller: { kind: 'operator' } },
    });
  });

  it('operator:reset-password refuses two different passwords and changes nothing', async () => {
    const result = await run('operator:reset-password', { answers: ['one password', 'another password'] });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('The two passwords differ');
    await expect(useCases.signIn({ email: OPERATOR.email, password: NEW_PASSWORD })).resolves.toMatchObject({
      isOk: true,
    });
  });
});
