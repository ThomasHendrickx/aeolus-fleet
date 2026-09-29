import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, identityUseCases, initialiseFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { createSignIn } from './sign-in.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let secret: string;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  useCases = identityUseCases(core);
  ({ fleetId, operatorShipId: argoId, secret } = await initialiseFleet(core));
  core.state.events.length = 0;
});

describe('signing in to the console', () => {
  it("exchanges argo's secret for a session token valid 30 days", async () => {
    const signedIn = await useCases.signIn({ secret });

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

  it('stores only the hash of the session token', async () => {
    const { token, consoleSessionId } = await useCases.signIn({ secret });

    expect(core.state.consoleSessions).toEqual([
      expect.objectContaining({ id: consoleSessionId, fleetId, shipId: argoId, tokenHash: core.hasher.hash(token) }),
    ]);
    expect(JSON.stringify(core.state)).not.toContain(`"${token}"`);
  });

  it("takes argo's lease from the web console and writes ShipClaimed by argo", async () => {
    const { consoleSessionId } = await useCases.signIn({ secret });

    const [lease] = core.state.leases;
    expect(lease).toMatchObject({ shipId: argoId, location: { kind: 'OTHER', description: 'web console' }, endedAt: null });
    expect(core.state.consoleSessions.find((session) => session.id === consoleSessionId)?.leaseId).toBe(lease?.id);
    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'ShipClaimed', actor: { kind: 'ship', shipId: argoId }, shipId: argoId }),
    ]);
  });

  it("marks argo's secret claimed on the first sign-in only", async () => {
    await useCases.signIn({ secret });
    const firstClaim = core.clock.now();
    core.clock.advance(60_000);
    await useCases.signIn({ secret });

    expect(core.state.credentials[0]?.claimedAt).toEqual(firstClaim);
  });

  it('refuses a wrong secret and writes nothing', async () => {
    await expect(useCases.signIn({ secret: 'aeolus_sk_v1_wrong' })).rejects.toMatchObject({ code: 'INVALID_SECRET' });

    expect(core.state.consoleSessions).toEqual([]);
    expect(core.state.leases).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it("refuses an agent ship's secret: only argo signs in to the console", async () => {
    const agent = addAgentShip(core, fleetId);

    await expect(useCases.signIn({ secret: agent.secret })).rejects.toMatchObject({ code: 'NOT_THE_OPERATOR_SHIP' });
    expect(core.state.consoleSessions).toEqual([]);
    expect(core.state.leases).toEqual([]);
  });
});

describe('signing in a second time', () => {
  it('ends the first session: its token stops working', async () => {
    const first = await useCases.signIn({ secret });
    const second = await useCases.signIn({ secret });

    await expect(useCases.authenticate.byConsoleSession(first.token)).resolves.toBeUndefined();
    await expect(useCases.authenticate.byConsoleSession(second.token)).resolves.toMatchObject({ shipId: argoId });
    expect(core.state.consoleSessions.filter((session) => session.endedAt === null)).toHaveLength(1);
  });

  it("takes argo's lease over: the first lease ends and its deliveries in flight return to pending", async () => {
    await useCases.signIn({ secret });
    core.state.deliveries.push({ id: 'dlv_in_flight', fleetId, state: 'delivered', claimedByShipId: argoId });
    core.state.events.length = 0;

    await useCases.signIn({ secret });

    expect(core.state.leases.map((lease) => lease.endedAt === null)).toEqual([false, true]);
    expect(core.state.deliveries[0]).toMatchObject({ state: 'pending', claimedByShipId: null });
    expect(core.state.events.map((event) => [event.type, event.actor])).toEqual([
      ['LeaseRevoked', { kind: 'ship', shipId: argoId }],
      ['ShipClaimed', { kind: 'ship', shipId: argoId }],
    ]);
    expect(core.state.events[0]?.details).toMatchObject({ reason: 'takenOver', returnedDeliveries: 1 });
  });

  it("keeps argo's secret valid", async () => {
    await useCases.signIn({ secret });
    await useCases.signIn({ secret });

    await expect(useCases.signIn({ secret })).resolves.toMatchObject({ caller: { shipId: argoId } });
    await expect(useCases.authenticate.bySecret(secret)).resolves.toMatchObject({ shipId: argoId });
  });

  it('leaves the first session working when the second sign-in fails', async () => {
    const first = await useCases.signIn({ secret });
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
    });

    await expect(failing({ secret })).rejects.toThrow('event log unavailable');

    await expect(useCases.authenticate.byConsoleSession(first.token)).resolves.toMatchObject({ shipId: argoId });
    expect(core.state.leases.filter((lease) => lease.endedAt === null)).toHaveLength(1);
  });
});
