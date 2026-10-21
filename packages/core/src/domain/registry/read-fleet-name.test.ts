import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { createReadFleetName, type ReadFleetName } from './read-fleet-name.js';

let core: InMemoryCore;
let readFleetName: ReadFleetName;

beforeEach(() => {
  core = createInMemoryCore('2026-10-21T12:00:00.000Z');
  readFleetName = createReadFleetName({ uow: core.uow });
});

describe("reading a fleet's name, for the header's title (header design H8)", () => {
  it('is the name the fleet was created with', async () => {
    const { fleetId } = await hostedFleet(core);

    await expect(readFleetName({ fleetId })).resolves.toEqual({ isOk: true, value: 'hemma' });
  });

  it('refuses a fleet the installation does not host', async () => {
    await expect(readFleetName({ fleetId: core.ids('fleet') })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });
});
