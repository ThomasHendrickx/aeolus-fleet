import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { createCreateFleet } from './create-fleet.js';
import { createGetInstallationFleet, type GetInstallationFleet } from './get-installation-fleet.js';

let core: InMemoryCore;
let getFleet: GetInstallationFleet;

beforeEach(() => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  getFleet = createGetInstallationFleet({ fleets: core.installationFleets, clock: core.clock });
});

describe('getting one fleet of the installation', () => {
  it('describes it as the list does', async () => {
    const { fleetId } = unwrap(
      await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids })({ requestId: 'signup-1', name: 'hemma', operatorEmail: 'lena@example.com' }),
    );

    await expect(getFleet({ fleetId })).resolves.toEqual({
      isOk: true,
      value: {
        fleetId,
        name: 'hemma',
        operatorEmail: 'lena@example.com',
        createdAt: new Date('2026-10-04T12:00:00.000Z'),
        shipCount: 1,
        messagesLast7Days: 0,
        lastActivityAt: new Date('2026-10-04T12:00:00.000Z'),
      },
    });
  });

  it('refuses a fleet the installation does not host', async () => {
    await expect(getFleet({ fleetId: core.ids('fleet') })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });
});
