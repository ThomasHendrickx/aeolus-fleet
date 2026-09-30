import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, crewShip, identityUseCases, initialiseFleet, OPERATOR } from '../../../test/support/core-fixtures.js';
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
  it('returns the ship the token crews, with only its own scopes', async () => {
    const agent = addAgentShip(core, { fleetId });
    const crewToken = crewShip(core, { fleetId, shipId: agent.shipId });

    await expect(useCases.authenticate.byCrewToken(crewToken)).resolves.toEqual({
      shipId: agent.shipId,
      fleetId,
      kind: 'agent',
      scopes: ['messages:send', 'messages:receive'],
    });
  });

  it('knows no unknown crew token', async () => {
    crewShip(core, { fleetId, shipId: addAgentShip(core, { fleetId }).shipId });

    await expect(useCases.authenticate.byCrewToken('aeolus_ct_v1_unknown')).resolves.toBeUndefined();
  });

  it('does not take the ship secret as a crew token: the secret works only for register', async () => {
    const agent = addAgentShip(core, { fleetId });
    crewShip(core, { fleetId, shipId: agent.shipId });

    await expect(useCases.authenticate.byCrewToken(agent.secret)).resolves.toBeUndefined();
  });

  it('knows no crew token once its lease has ended', async () => {
    const agent = addAgentShip(core, { fleetId });
    const crewToken = crewShip(core, { fleetId, shipId: agent.shipId });
    for (const lease of core.state.leases) {
      lease.endedAt = core.clock.now();
    }

    await expect(useCases.authenticate.byCrewToken(crewToken)).resolves.toBeUndefined();
  });

  it('knows no crew token of a retired ship', async () => {
    const agent = addAgentShip(core, { fleetId, retiredAt: core.clock.now() });
    const crewToken = crewShip(core, { fleetId, shipId: agent.shipId });

    await expect(useCases.authenticate.byCrewToken(crewToken)).resolves.toBeUndefined();
  });

  it('does not take the console session token as a crew token', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));

    await expect(useCases.authenticate.byCrewToken(token)).resolves.toBeUndefined();
  });
});

describe('authenticating with a console session', () => {
  it('returns argo with the session id, and the expiry this use moved to', async () => {
    const { token, consoleSessionId } = unwrap(await useCases.signIn(OPERATOR));
    core.clock.advance(DAY_MS);

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toEqual({
      caller: {
        shipId: argoId,
        fleetId,
        kind: 'operator',
        scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
        consoleSessionId,
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
