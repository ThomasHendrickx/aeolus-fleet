import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, historyUseCases, hostedFleetWithViewer, hostedFleet, identityUseCases, messagingUseCases, modelOf, openLeaseOf, registryUseCases } from '../../../test/support/core-fixtures.js';
import { newKey } from '../../../test/support/keys.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { SignedIn } from './sign-in.js';

// Viewer sessions (decision 0022): many people view a fleet at once through
// its viewer ship, each with a console session that holds no lease, valid 2
// hours after its last use and never more than 24 hours after it started.

const HOUR_MS = 60 * 60 * 1000;

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let viewerId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-05T09:00:00.000Z');
  useCases = identityUseCases(core);
  ({ fleetId, operatorShipId: argoId, viewerShipId: viewerId } = await hostedFleetWithViewer(core));
  core.state.events.length = 0;
});

async function viewing(device = 'iPhone · Safari'): Promise<SignedIn> {
  const { ticket } = unwrap(await useCases.issueSignInTicket({ fleetId, as: 'viewer' }));
  return unwrap(await useCases.redeemSignInTicket({ ticket, device }));
}

async function operating(): Promise<SignedIn> {
  const { ticket } = unwrap(await useCases.issueSignInTicket({ fleetId }));
  return unwrap(await useCases.redeemSignInTicket({ ticket, device: 'Mac · Chrome' }));
}

describe('a viewer ticket', () => {
  it('is issued for a fleet with a viewer ship, and says so on SignInTicketIssued', async () => {
    unwrap(await useCases.issueSignInTicket({ fleetId, as: 'viewer' }));

    expect(core.state.events).toEqual([expect.objectContaining({ fleetId, type: 'SignInTicketIssued', details: { as: 'viewer' } })]);
  });

  it('is refused for a fleet without a viewer ship', async () => {
    const other = await hostedFleet(core, 'olle@example.com');

    await expect(useCases.issueSignInTicket({ fleetId: other.fleetId, as: 'viewer' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'FLEET_HAS_NO_VIEWER', message: `Fleet ${other.fleetId} has no viewer ship: create it with one to hand out viewer tickets` },
    });
  });

  it('starts a viewer session: the viewer ship, reading the fleet only, holding no lease', async () => {
    const signedIn = await viewing();

    expect(signedIn.caller).toEqual({ shipId: viewerId, fleetId, kind: 'viewer', scopes: ['fleet:read'], consoleSessionId: signedIn.consoleSessionId });
    expect(signedIn.expiresAt).toEqual(new Date(core.clock.now().getTime() + 2 * HOUR_MS));
    expect(core.state.consoleSessions).toEqual([expect.objectContaining({ id: signedIn.consoleSessionId, shipId: viewerId, leaseId: null, device: 'iPhone · Safari' })]);
    expect(core.state.leases).toEqual([]);
  });

  it('writes ViewerSessionStarted, by the viewer ship, with the device', async () => {
    await viewing();

    expect(core.state.events.at(-1)).toMatchObject({ fleetId, type: 'ViewerSessionStarted', actor: { kind: 'ship', shipId: viewerId }, shipId: viewerId, details: { device: 'iPhone · Safari' } });
  });
});

describe('viewer sessions and the operator', () => {
  it('run many at once: a new one ends none', async () => {
    const first = await viewing();
    const second = await viewing('Windows · Edge');

    expect(core.state.consoleSessions.map((session) => [session.id, session.endedAt])).toEqual([
      [first.consoleSessionId, null],
      [second.consoleSessionId, null],
    ]);
  });

  it("leave argo's session and lease alone, and the operator's sign-in leaves them running", async () => {
    const operator = await operating();
    const viewer = await viewing();
    const leaseId = openLeaseOf(core, argoId);

    const operatorAgain = await operating();

    const sessions = new Map(core.state.consoleSessions.map((session) => [session.id, session.endReason]));
    expect(sessions.get(operator.consoleSessionId)).toBe('takenOver');
    expect(sessions.get(viewer.consoleSessionId)).toBeNull();
    expect(sessions.get(operatorAgain.consoleSessionId)).toBeNull();
    expect(leaseId).not.toBe(openLeaseOf(core, argoId));
  });
});

describe('using a viewer session', () => {
  it('answers the viewer ship without a lease, valid 2 hours after this use', async () => {
    const { token, consoleSessionId } = await viewing();
    core.clock.advance(HOUR_MS);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toEqual({
      caller: { shipId: viewerId, fleetId, kind: 'viewer', scopes: ['fleet:read'], consoleSessionId },
      expiresAt: new Date(core.clock.now().getTime() + 2 * HOUR_MS),
    });
  });

  it('has expired 2 hours after its last use', async () => {
    const { token } = await viewing();
    core.clock.advance(2 * HOUR_MS - 1);
    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeDefined();
    core.clock.advance(2 * HOUR_MS);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
  });

  it('is never renewed past 24 hours after it started, and has expired then', async () => {
    const { token } = await viewing();
    for (let hour = 0; hour < 23; hour += 1) {
      core.clock.advance(HOUR_MS);
      await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeDefined();
    }
    core.clock.advance(HOUR_MS / 2);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toMatchObject({ expiresAt: new Date('2026-10-06T09:00:00.000Z') });
    core.clock.advance(HOUR_MS / 2);
    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
  });
});

describe('what a viewer session may do', () => {
  it('reads its account as the viewer: its session, no email and no theme', async () => {
    const { caller } = await viewing();

    await expect(useCases.readAccount(caller)).resolves.toEqual({
      isOk: true,
      value: { kind: 'viewer', session: { device: 'iPhone · Safari', since: core.clock.now() } },
    });
  });

  it('chooses no theme: the theme belongs to the operator', async () => {
    const { caller } = await viewing();

    await expect(useCases.setTheme(caller, { theme: 'dark' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR_SHIP' } });
    expect(core.state.operatorAccounts[0]?.theme).toBe('system');
  });

  it('signs out alone: its session ends, and no lease is touched', async () => {
    await operating();
    const leaseId = openLeaseOf(core, argoId);
    const { caller, consoleSessionId } = await viewing();

    await useCases.signOut(caller);

    expect(core.state.consoleSessions.find((session) => session.id === consoleSessionId)).toMatchObject({ endReason: 'signedOut' });
    expect(openLeaseOf(core, argoId)).toBe(leaseId);
  });
});

describe('what a viewer session reads', () => {
  it("reads argo's inbox, as the operator sees it", async () => {
    const operator = await operating();
    const { shipId } = unwrap(await registryUseCases(core).commissionShip(operator.caller, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const scout = crewAboard(core, { fleetId, shipId });
    unwrap(await messagingUseCases(core).sendMessage(scout, { ...modelOf(scout), selector: { kind: 'ship', shipId: argoId }, payload: 'Run 71 passed', idempotencyKey: newKey() }));
    const viewer = await viewing();

    const seen = await historyUseCases(core).readInbox(viewer.caller, { filter: 'all' });

    expect(seen.map((entry) => entry.message.payload)).toEqual(['Run 71 passed']);
    expect(seen).toEqual(await historyUseCases(core).readInbox(operator.caller, { filter: 'all' }));
  });

  it('shows the viewer ship last seen when its most recent viewer session was used, with no device', async () => {
    const first = await viewing();
    core.clock.advance(10 * 60 * 1000);
    await viewing('Windows · Edge');
    core.clock.advance(5 * 60 * 1000);
    const usedAt = core.clock.now();
    await useCases.authenticate.byConsoleSession(first.token);

    const listed = (await registryUseCases(core).listFleet(first.caller)).find((ship) => ship.id === viewerId);

    expect(listed).toMatchObject({ status: 'crewed', lastSeenAt: usedAt, location: null });
  });

  it('shows the viewer ship never seen before any viewer session', async () => {
    const operator = await operating();

    const listed = (await registryUseCases(core).listFleet(operator.caller)).find((ship) => ship.id === viewerId);

    expect(listed).toMatchObject({ lastSeenAt: null });
  });
});
