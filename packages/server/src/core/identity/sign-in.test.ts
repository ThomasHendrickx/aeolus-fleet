import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases, initialiseFleet, OPERATOR } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { createSignIn } from './sign-in.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const WRONG_EMAIL_OR_PASSWORD = {
  isOk: false,
  error: { kind: 'WRONG_EMAIL_OR_PASSWORD', message: 'Wrong email or password' },
};

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;
let argoId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  useCases = identityUseCases(core);
  ({ fleetId, operatorShipId: argoId } = await initialiseFleet(core));
  core.state.events.length = 0;
});

describe('signing in to the console', () => {
  it("exchanges the operator's email and password for a session token valid 30 days, crewing argo", async () => {
    const signedIn = unwrap(await useCases.signIn(OPERATOR));

    expect(signedIn.token).toEqual(expect.any(String));
    expect(signedIn.expiresAt).toEqual(new Date(core.clock.now().getTime() + THIRTY_DAYS_MS));
    expect(signedIn.caller).toEqual({
      shipId: argoId,
      fleetId,
      kind: 'operator',
      scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
      consoleSessionId: signedIn.consoleSessionId,
    });
  });

  it('finds the email with spaces around it or in capitals', async () => {
    await expect(
      useCases.signIn({ email: ` ${OPERATOR.email.toUpperCase()}\n`, password: OPERATOR.password }),
    ).resolves.toMatchObject({ isOk: true, value: { caller: { shipId: argoId } } });
  });

  it('stores only the hash of the session token', async () => {
    const { token, consoleSessionId } = unwrap(await useCases.signIn(OPERATOR));

    expect(core.state.consoleSessions).toEqual([
      expect.objectContaining({ id: consoleSessionId, fleetId, shipId: argoId, tokenHash: core.hasher.hash(token) }),
    ]);
    expect(JSON.stringify(core.state)).not.toContain(`"${token}"`);
  });

  it("takes argo's lease from the web console and writes ShipClaimed by argo", async () => {
    const { consoleSessionId } = unwrap(await useCases.signIn(OPERATOR));

    const [lease] = core.state.leases;
    expect(lease).toMatchObject({ shipId: argoId, location: { kind: 'OTHER', description: 'web console' }, endedAt: null });
    expect(core.state.consoleSessions.find((session) => session.id === consoleSessionId)?.leaseId).toBe(lease?.id);
    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'ShipClaimed', actor: { kind: 'ship', shipId: argoId }, shipId: argoId }),
    ]);
  });

  it('refuses a wrong password and writes nothing', async () => {
    await expect(useCases.signIn({ email: OPERATOR.email, password: 'wrong horse' })).resolves.toEqual(
      WRONG_EMAIL_OR_PASSWORD,
    );

    expect(core.state.consoleSessions).toEqual([]);
    expect(core.state.leases).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it('refuses an unknown email with the very same error as a wrong password, and writes nothing', async () => {
    await expect(useCases.signIn({ email: 'stranger@example.com', password: OPERATOR.password })).resolves.toEqual(
      WRONG_EMAIL_OR_PASSWORD,
    );

    expect(core.state.consoleSessions).toEqual([]);
    expect(core.state.leases).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it('checks the password even for an unknown email, so both refusals take as long', async () => {
    const checked: (string | undefined)[] = [];
    const signIn = createSignIn({
      uow: core.uow,
      clock: core.clock,
      ids: core.ids,
      hasher: core.hasher,
      random: core.random,
      passwords: {
        ...core.passwords,
        verify: (password, passwordHash) => {
          checked.push(passwordHash);
          return core.passwords.verify(password, passwordHash);
        },
      },
    });

    await signIn({ email: 'stranger@example.com', password: OPERATOR.password });

    expect(checked).toEqual([undefined]);
  });

  it('refuses a password that differs only in capitals or spaces', async () => {
    await expect(
      useCases.signIn({ email: OPERATOR.email, password: OPERATOR.password.toUpperCase() }),
    ).resolves.toEqual(WRONG_EMAIL_OR_PASSWORD);
    await expect(useCases.signIn({ email: OPERATOR.email, password: ` ${OPERATOR.password}` })).resolves.toEqual(
      WRONG_EMAIL_OR_PASSWORD,
    );
  });
});

describe('signing in a second time', () => {
  it('ends the previous session: its token stops working', async () => {
    const first = unwrap(await useCases.signIn(OPERATOR));
    const second = unwrap(await useCases.signIn(OPERATOR));

    await expect(useCases.authenticate.byConsoleSession(first.token)).resolves.toBeUndefined();
    await expect(useCases.authenticate.byConsoleSession(second.token)).resolves.toMatchObject({ caller: { shipId: argoId } });
    expect(core.state.consoleSessions.filter((session) => session.endedAt === null)).toHaveLength(1);
  });

  it("takes argo's lease over: the first lease ends and its deliveries in flight return to pending", async () => {
    unwrap(await useCases.signIn(OPERATOR));
    core.state.deliveries.push({ id: 'dlv_in_flight', fleetId, state: 'delivered', claimedByShipId: argoId });
    core.state.events.length = 0;

    unwrap(await useCases.signIn(OPERATOR));

    expect(core.state.leases.map((lease) => lease.endedAt === null)).toEqual([false, true]);
    expect(core.state.deliveries[0]).toMatchObject({ state: 'pending', claimedByShipId: null });
    expect(core.state.events.map((event) => [event.type, event.actor])).toEqual([
      ['LeaseRevoked', { kind: 'ship', shipId: argoId }],
      ['ShipClaimed', { kind: 'ship', shipId: argoId }],
    ]);
    expect(core.state.events[0]?.details).toMatchObject({ reason: 'takenOver', returnedDeliveries: 1 });
  });

  it('leaves the previous session alone when the new one gives a wrong password', async () => {
    const first = unwrap(await useCases.signIn(OPERATOR));

    await useCases.signIn({ email: OPERATOR.email, password: 'wrong horse' });

    await expect(useCases.authenticate.byConsoleSession(first.token)).resolves.toMatchObject({ caller: { shipId: argoId } });
  });

  it('leaves the first session working when the second sign-in fails', async () => {
    const first = unwrap(await useCases.signIn(OPERATOR));
    const failing = createSignIn({
      uow: {
        run: (work) =>
          core.uow.run((tx) =>
            work({ ...tx, events: { append: () => Promise.reject(new Error('event log unavailable')) } }),
          ),
      },
      clock: core.clock,
      ids: core.ids,
      hasher: core.hasher,
      random: core.random,
      passwords: core.passwords,
    });

    await expect(failing(OPERATOR)).rejects.toThrow('event log unavailable');

    await expect(useCases.authenticate.byConsoleSession(first.token)).resolves.toMatchObject({ caller: { shipId: argoId } });
    expect(core.state.leases.filter((lease) => lease.endedAt === null)).toHaveLength(1);
  });
});
