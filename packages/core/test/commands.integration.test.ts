import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { runServerCommand } from './support/commands.js';
import { giveOperatorLogin } from './support/operator-login.js';
import { FLEET_URL, OPERATOR } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { unwrap } from '../src/testing/result.js';

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
  it('fleet:init asks nothing, creates the fleet, argo without a secret and its own sign-in without email or password, and prints a link that signs in as argo', async () => {
    const result = await run('fleet:init', { args: ['--name', 'home fleet'] });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Operator account: opr_');
    expect(result.stdout).not.toMatch(/aeolus_sk_v1_/);
    await expect(database.credential.count()).resolves.toBe(0);
    await expect(database.fleet.findMany()).resolves.toEqual([expect.objectContaining({ name: 'home fleet' })]);
    await expect(database.operator.findMany()).resolves.toEqual([expect.objectContaining({ email: null, passwordHash: null })]);
    const ticket = new URL(/Open (\S+) to sign in/.exec(result.stdout)?.[1] ?? 'http://missing').searchParams.get('ticket') ?? '';
    await expect(useCases.redeemSignInTicket({ ticket })).resolves.toMatchObject({ isOk: true, value: { caller: { kind: 'operator' } } });
  });

  it('fleet:init refuses a second run', async () => {
    const result = await run('fleet:init', {
      args: ['--name', 'second fleet'],
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('A fleet already exists');
    expect(result.stdout).not.toMatch(/aeolus_sk_v1_/);
    await expect(database.fleet.count()).resolves.toBe(1);
    await expect(database.operator.count()).resolves.toBe(1);
  });

  it('operator:reset-password asks for a new password, ends the sessions, and the old password stops working', async () => {
    const { fleetId, id: operatorId } = await database.operator.findFirstOrThrow();
    await giveOperatorLogin(database, { fleetId, operatorId });
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
