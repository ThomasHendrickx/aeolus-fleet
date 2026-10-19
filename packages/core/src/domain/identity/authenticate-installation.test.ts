import { createIdGenerator, type FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { unwrap } from '../../testing/result.js';
import { createAuthenticateInstallation } from './authenticate-installation.js';
import type { HostedFleets } from './ports.js';

const newId = createIdGenerator();
const fleetId = newId('fleet');

function authenticateInstallationIn(fleets: readonly FleetId[]) {
  const hosted: HostedFleets = { isHosted: (id) => Promise.resolve(fleets.includes(id)) };
  return createAuthenticateInstallation({ fleets: hosted });
}

describe('authenticating the installation in a fleet', () => {
  it('makes the installation the caller, with the scopes its jobs need there that the catalogue holds (decision 0020)', async () => {
    const authenticate = authenticateInstallationIn([fleetId]);

    expect(unwrap(await authenticate({ fleetId }))).toEqual({ kind: 'installation', fleetId, scopes: ['fleet:manage', 'labels:define', 'labels:assign'] });
  });

  it('refuses a fleet this installation does not host', async () => {
    const authenticate = authenticateInstallationIn([]);

    expect(await authenticate({ fleetId })).toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });
});
