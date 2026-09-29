import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, identityUseCases, initialiseFleet, OPERATOR } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let secret: string;

beforeEach(async () => {
  core = createInMemoryCore();
  useCases = identityUseCases(core);
  ({ fleetId, operatorShipId: argoId, secret } = await initialiseFleet(core));
});

describe('authenticating with a ship secret', () => {
  it("returns argo with its fleet, kind and every scope", async () => {
    await expect(useCases.authenticate.bySecret(secret)).resolves.toEqual({
      shipId: argoId,
      fleetId,
      kind: 'operator',
      scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
    });
  });

  it('returns an agent with only its own scopes', async () => {
    const agent = addAgentShip(core, { fleetId });

    await expect(useCases.authenticate.bySecret(agent.secret)).resolves.toEqual({
      shipId: agent.shipId,
      fleetId,
      kind: 'agent',
      scopes: ['messages:send', 'messages:receive'],
    });
  });

  it('knows no unknown secret', async () => {
    await expect(useCases.authenticate.bySecret('aeolus_sk_v1_unknown')).resolves.toBeUndefined();
  });

  it('knows no secret of a retired ship', async () => {
    const agent = addAgentShip(core, { fleetId });
    const ship = core.state.ships.find((candidate) => candidate.id === agent.shipId);
    if (ship) {
      ship.retiredAt = core.clock.now();
    }

    await expect(useCases.authenticate.bySecret(agent.secret)).resolves.toBeUndefined();
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
