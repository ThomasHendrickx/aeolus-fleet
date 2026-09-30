import { createIdGenerator, type FleetId, type OperatorId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  deliveryInFlight,
  identityUseCases,
  initialiseFleet,
  OPERATOR,
  openLeaseOf,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { createResetOperatorPassword } from './reset-operator-password.js';

const NEW_PASSWORD = 'staple battery horse correct';

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let resetOperatorPassword: ReturnType<typeof createResetOperatorPassword>;
let fleetId: FleetId;
let argoId: ShipId;
let operatorId: OperatorId;

beforeEach(async () => {
  core = createInMemoryCore();
  useCases = identityUseCases(core);
  resetOperatorPassword = createResetOperatorPassword({
    uow: core.uow,
    clock: core.clock,
    ids: core.ids,
    passwords: core.passwords,
  });
  ({ fleetId, operatorShipId: argoId, operatorId } = await initialiseFleet(core));
});

describe('resetting the operator password', () => {
  it('makes the old password fail and the new one sign in', async () => {
    unwrap(await resetOperatorPassword({ fleetId, password: NEW_PASSWORD }));

    await expect(useCases.signIn(OPERATOR)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'WRONG_EMAIL_OR_PASSWORD' },
    });
    await expect(useCases.signIn({ email: OPERATOR.email, password: NEW_PASSWORD })).resolves.toMatchObject({
      isOk: true,
      value: { caller: { shipId: argoId } },
    });
  });

  it('stores only the hash of the new password, and keeps the email', async () => {
    unwrap(await resetOperatorPassword({ fleetId, password: NEW_PASSWORD }));

    expect(core.state.operatorAccounts).toEqual([
      expect.objectContaining({
        id: operatorId,
        email: OPERATOR.email,
        passwordHash: await core.passwords.hash(NEW_PASSWORD),
      }),
    ]);
    expect(JSON.stringify(core.state)).not.toContain(`"${NEW_PASSWORD}"`);
  });

  it("ends every console session and argo's lease, and writes OperatorPasswordReset, LeaseRevoked and DeliveryReturned by the system", async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));
    const { deliveryId } = deliveryInFlight(core, { fleetId, shipId: argoId, leaseId: openLeaseOf(core, argoId) });
    core.state.events.length = 0;

    unwrap(await resetOperatorPassword({ fleetId, password: NEW_PASSWORD }));

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    expect(core.state.consoleSessions.every((session) => session.endedAt !== null)).toBe(true);
    expect(core.state.leases.every((lease) => lease.endedAt !== null)).toBe(true);
    expect(core.state.deliveries[0]).toMatchObject({ state: 'pending', claimedByShipId: null });
    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'OperatorPasswordReset', actor: { kind: 'system' }, details: { operatorId } }),
      expect.objectContaining({ type: 'LeaseRevoked', actor: { kind: 'system' }, shipId: argoId }),
      expect.objectContaining({ type: 'DeliveryReturned', actor: { kind: 'system' }, shipId: argoId, deliveryId }),
    ]);
    expect(core.state.events[1]?.details).toMatchObject({ reason: 'passwordReset', returnedDeliveries: 1 });
  });

  it('also ends a session that expired without signing out', async () => {
    const { consoleSessionId } = unwrap(await useCases.signIn(OPERATOR));
    core.clock.advance(31 * 24 * 60 * 60 * 1000);

    unwrap(await resetOperatorPassword({ fleetId, password: NEW_PASSWORD }));

    expect(core.state.consoleSessions.find((session) => session.id === consoleSessionId)?.endedAt).toEqual(
      core.clock.now(),
    );
    expect(core.state.leases.every((lease) => lease.endedAt !== null)).toBe(true);
  });

  it("writes OperatorPasswordReset about argo, so it shows on argo's timeline", async () => {
    core.state.events.length = 0;

    unwrap(await resetOperatorPassword({ fleetId, password: NEW_PASSWORD }));

    expect(core.state.events).toEqual([expect.objectContaining({ type: 'OperatorPasswordReset', shipId: argoId })]);
  });

  it('writes only OperatorPasswordReset when nobody is signed in', async () => {
    core.state.events.length = 0;

    unwrap(await resetOperatorPassword({ fleetId, password: NEW_PASSWORD }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'OperatorPasswordReset', actor: { kind: 'system' }, details: { operatorId } }),
    ]);
  });

  it('refuses an empty password and changes nothing', async () => {
    const { token } = unwrap(await useCases.signIn(OPERATOR));
    const before = structuredClone(core.state);

    await expect(resetOperatorPassword({ fleetId, password: '' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_PASSWORD' },
    });

    expect(core.state).toEqual(before);
    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeDefined();
  });

  it('refuses a fleet that does not exist', async () => {
    const unknown = createIdGenerator()('fleet');

    await expect(resetOperatorPassword({ fleetId: unknown, password: NEW_PASSWORD })).resolves.toEqual({
      isOk: false,
      error: { kind: 'FLEET_NOT_FOUND', message: `Fleet ${unknown} does not exist` },
    });
  });
});
