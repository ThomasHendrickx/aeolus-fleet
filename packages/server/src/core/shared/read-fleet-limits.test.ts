import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, crewAboard, deliveryInFlight, initialiseFleet, operatorCaller, withInstallationSettings } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import type { Caller } from './caller.js';
import { createReadFleetLimits, type ReadFleetLimits } from './read-fleet-limits.js';

let core: InMemoryCore;
let readLimits: ReadFleetLimits;
let fleetId: FleetId;
let argo: Caller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  readLimits = createReadFleetLimits({ limits: core.fleetLimitReads, clock: core.clock });
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
});

describe("reading the caller's fleet's limits", () => {
  it('gives no limit for either while none applies, with what each counts', async () => {
    await expect(readLimits(argo)).resolves.toEqual({
      ships: { limit: null, count: 1 },
      dailyMessages: { limit: null, count: 0, resetsAt: new Date('2026-10-05T00:00:00.000Z') },
    });
  });

  it("counts the ships that are not retired, argo included, and the messages stored since 00:00 UTC, against the limits that apply", async () => {
    withInstallationSettings(core, { defaultShipLimit: 10, defaultDailyMessageLimit: 1000 });
    const scout = addAgentShip(core, { fleetId });
    addAgentShip(core, { fleetId, retiredAt: core.clock.now() });
    const crew = crewAboard(core, { fleetId, shipId: scout.shipId });
    deliveryInFlight(core, { fleetId, shipId: scout.shipId, leaseId: crew.leaseId });
    core.clock.set('2026-10-03T23:00:00.000Z');
    deliveryInFlight(core, { fleetId, shipId: scout.shipId, leaseId: crew.leaseId });
    core.clock.set('2026-10-04T12:00:00.000Z');

    await expect(readLimits(argo)).resolves.toEqual({
      ships: { limit: 10, count: 2 },
      dailyMessages: { limit: 1000, count: 1, resetsAt: new Date('2026-10-05T00:00:00.000Z') },
    });
  });
});
