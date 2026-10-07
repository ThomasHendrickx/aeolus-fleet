import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, crewShip, identityUseCases, initialiseFleet, OPERATOR, openLeaseOf } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;
let argoId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore();
  useCases = identityUseCases(core);
  ({ fleetId, operatorShipId: argoId } = await initialiseFleet(core));
});

describe('authenticating with a crew token', () => {
  it('returns the ship the token crews, with only its own scopes, and the lease the token belongs to', async () => {
    const agent = addAgentShip(core, { fleetId });
    const crewToken = crewShip(core, { fleetId, shipId: agent.shipId });
    const [lease] = core.state.leases;

    expect(unwrap(await useCases.authenticate.byCrewToken(crewToken))).toEqual({
      shipId: agent.shipId,
      fleetId,
      kind: 'agent',
      scopes: ['messages:send', 'messages:receive'],
      leaseId: lease?.id,
    });
  });

  it('knows no unknown crew token, and says to call with the one register gave', async () => {
    crewShip(core, { fleetId, shipId: addAgentShip(core, { fleetId }).shipId });

    await expect(useCases.authenticate.byCrewToken('aeolus_ct_v1_unknown')).resolves.toEqual({
      isOk: false,
      error: { kind: 'UNKNOWN_CREW_TOKEN', message: 'Call with the crew token register gave you' },
    });
  });

  it('does not take the ship secret as a crew token: the secret works only for register', async () => {
    const agent = addAgentShip(core, { fleetId });
    crewShip(core, { fleetId, shipId: agent.shipId });

    await expect(useCases.authenticate.byCrewToken(agent.secret)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'UNKNOWN_CREW_TOKEN' },
    });
  });

  it('refuses a crew token whose lease has ended as LEASE_ENDED: the ship was released, and this session no longer crews it', async () => {
    const agent = addAgentShip(core, { fleetId });
    const crewToken = crewShip(core, { fleetId, shipId: agent.shipId });
    for (const lease of core.state.leases) {
      lease.endedAt = core.clock.now();
    }

    await expect(useCases.authenticate.byCrewToken(crewToken)).resolves.toEqual({
      isOk: false,
      error: { kind: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' },
    });
  });

  it('knows no crew token of a retired ship', async () => {
    const agent = addAgentShip(core, { fleetId, retiredAt: core.clock.now() });
    const crewToken = crewShip(core, { fleetId, shipId: agent.shipId });

    await expect(useCases.authenticate.byCrewToken(crewToken)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'UNKNOWN_CREW_TOKEN' },
    });
  });

  it('does not take the console session token as a crew token', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));

    await expect(useCases.authenticate.byCrewToken(token)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'UNKNOWN_CREW_TOKEN' },
    });
  });
});

describe('a ship seen through its calls', () => {
  it("marks the crew's lease seen each time its crew token is used", async () => {
    const shipId = addAgentShip(core, { fleetId }).shipId;
    const crewToken = crewShip(core, { fleetId, shipId });
    core.clock.advance(20_000);

    unwrap(await useCases.authenticate.byCrewToken(crewToken));
    expect(core.state.leaseSeen).toEqual([expect.objectContaining({ leaseId: openLeaseOf(core, shipId), at: core.clock.now() })]);

    core.clock.advance(25_000);
    unwrap(await useCases.authenticate.byCrewToken(crewToken));
    expect(core.state.leaseSeen).toEqual([expect.objectContaining({ at: core.clock.now() })]);
  });

  it("marks argo's lease seen each time its console session is used", async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));
    core.clock.advance(20_000);

    await useCases.authenticate.byConsoleSession(token);
    expect(core.state.leaseSeen).toEqual([expect.objectContaining({ leaseId: openLeaseOf(core, argoId), at: core.clock.now() })]);
  });
});

describe('authenticating with a console session', () => {
  it('returns argo with the session id and the lease it holds on argo, and the expiry this use moved to', async () => {
    const { token, consoleSessionId } = unwrap(await useCases.signIn(OPERATOR));
    const leaseId = core.state.consoleSessions.find((session) => session.id === consoleSessionId)?.leaseId;
    core.clock.advance(DAY_MS);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toEqual({
      caller: {
        shipId: argoId,
        fleetId,
        kind: 'operator',
        scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign'],
        consoleSessionId,
        leaseId,
      },
      expiresAt: new Date(core.clock.now().getTime() + 30 * DAY_MS),
    });
  });

  it('works until just before 30 days after the last use', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));
    core.clock.advance(30 * DAY_MS - 1);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toMatchObject({ caller: { shipId: argoId } });
  });

  it('has expired 30 days after the last use', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));
    core.clock.advance(30 * DAY_MS);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
  });

  it('counts the 30 days from the last use, not from signing in', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));
    core.clock.advance(29 * DAY_MS);
    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeDefined();
    core.clock.advance(29 * DAY_MS);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toMatchObject({ caller: { shipId: argoId } });
    expect(core.state.consoleSessions[0]).toMatchObject({
      lastUsedAt: core.clock.now(),
      expiresAt: new Date(core.clock.now().getTime() + 30 * DAY_MS),
    });
  });

  it('knows no unknown token', async () => {
    unwrap(await useCases.signIn(OPERATOR));

    await expect(useCases.authenticate.byConsoleSession('not-a-token')).resolves.toBeUndefined();
  });

  it('does not take the password as a session token', async () => {
    unwrap(await useCases.signIn(OPERATOR));

    await expect(useCases.authenticate.byConsoleSession(OPERATOR.password)).resolves.toBeUndefined();
  });
});

describe('why a console session ended', () => {
  it('says a session ended by signing in somewhere else was taken over', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));
    unwrap(await useCases.signIn(OPERATOR));

    await expect(useCases.authenticate.endOfConsoleSession(token)).resolves.toBe('takenOver');
  });

  it('says a signed-out session was signed out', async () => {
    const { token, caller } = unwrap(await useCases.signIn(OPERATOR));
    await useCases.signOut(caller);

    await expect(useCases.authenticate.endOfConsoleSession(token)).resolves.toBe('signedOut');
  });

  it('says a session the password reset ended ended that way', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));
    unwrap(await useCases.resetOperatorPassword({ fleetId, password: 'a brand new passphrase' }));

    await expect(useCases.authenticate.endOfConsoleSession(token)).resolves.toBe('passwordReset');
  });

  it('says nothing of a live session', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));

    await expect(useCases.authenticate.endOfConsoleSession(token)).resolves.toBeUndefined();
  });

  it('says nothing of an expired session: nothing ended it', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));
    core.clock.advance(30 * DAY_MS);

    await expect(useCases.authenticate.endOfConsoleSession(token)).resolves.toBeUndefined();
  });

  it('says nothing of an unknown token', async () => {
    await expect(useCases.authenticate.endOfConsoleSession('not-a-token')).resolves.toBeUndefined();
  });
});
