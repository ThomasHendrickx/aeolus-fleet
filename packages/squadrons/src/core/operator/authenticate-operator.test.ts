import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import type { ManagementCrewStore } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { createAuthenticateOperator } from './authenticate-operator.js';
import type { ConsoleSessions } from './ports.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sw';
const SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';

const sessions: ConsoleSessions = {
  check: (cookie) =>
    Promise.resolve(
      cookie === 'aeolus_session=ours'
        ? ok({ fleetId: FLEET })
        : cookie === 'aeolus_session=theirs'
          ? ok({ fleetId: OTHER_FLEET })
          : err({ code: 'UNAUTHORIZED', message: 'No signed-in console session' }),
    ),
};

/** A store bound to a fleet, connected or with its crew token dropped; or never connected. */
function storeFor(bound: { fleetId: FleetId; isConnected?: boolean } | undefined): ManagementCrewStore {
  return {
    find: () =>
      Promise.resolve(bound && bound.isConnected !== false ? { fleetId: bound.fleetId, shipId: SHIP, name: 'squadrons', crewToken: 'aeolus_ct_v1_x', crewedAt: new Date(0) } : undefined),
    binding: () => Promise.resolve(bound && { fleetId: bound.fleetId, shipId: SHIP }),
    save: () => Promise.resolve(),
    drop: () => Promise.resolve(),
  };
}

describe('the operator', () => {
  it('is the signed-in console session of the fleet squadrons serves', async () => {
    const authenticate = createAuthenticateOperator({ sessions, store: storeFor({ fleetId: FLEET }) });

    await expect(authenticate('aeolus_session=ours')).resolves.toEqual({ isOk: true, value: { fleetId: FLEET } });
  });

  it.each([
    ['no cookie', undefined],
    ['a cookie of no signed-in session', 'aeolus_session=stale'],
    ["another fleet's operator", 'aeolus_session=theirs'],
  ])('is refused for %s', async (_label, cookie) => {
    const authenticate = createAuthenticateOperator({ sessions, store: storeFor({ fleetId: FLEET }) });

    await expect(authenticate(cookie)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR' } });
  });

  it('is any signed-in operator of the fleet at its FLEET_URL before squadrons was ever connected: who may connect it', async () => {
    const authenticate = createAuthenticateOperator({ sessions, store: storeFor(undefined) });

    await expect(authenticate('aeolus_session=theirs')).resolves.toMatchObject({ isOk: true });
  });

  it("stays the operator of the fleet squadrons was connected to once its crew token was dropped: another fleet's is refused", async () => {
    const authenticate = createAuthenticateOperator({ sessions, store: storeFor({ fleetId: FLEET, isConnected: false }) });

    await expect(authenticate('aeolus_session=ours')).resolves.toMatchObject({ isOk: true });
    await expect(authenticate('aeolus_session=theirs')).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR' } });
  });
});
