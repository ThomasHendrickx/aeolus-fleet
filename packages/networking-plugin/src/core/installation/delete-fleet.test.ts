import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { memoryFleetSwitches, memoryForgetter, memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { suppliedFleet } from '../../../test/support/supplied-fleet.js';
import { createDeleteFleet } from './delete-fleet.js';

const FLEET: FleetId = FLEET_ID;
const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-04T12:00:00.000Z');

let switches: ReturnType<typeof memoryFleetSwitches>;
let requests: ReturnType<typeof memoryInstallationRequests>;
let forgetter: ReturnType<typeof memoryForgetter>;
let deleteFleet: ReturnType<typeof createDeleteFleet>;
let parts: Awaited<ReturnType<typeof suppliedFleet>>;

beforeEach(async () => {
  parts = await suppliedFleet();
  switches = memoryFleetSwitches();
  requests = memoryInstallationRequests();
  forgetter = memoryForgetter({ switches, requests });
  deleteFleet = createDeleteFleet({ forgetter, requests, hasher: plainHasher, clock: { now: () => AT }, door: parts.fleet.door, connections: parts.connections });
  await switches.set(FLEET, { isEnabled: true, at: AT });
  await parts.networks.save(FLEET, { rules: [{ from: [], to: [] }], declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 } });
  await parts.supplies.supply(FLEET);
});

describe('deleting a fleet from the networking plugin', () => {
  it('forgets everything of the fleet, its switch included, and keeps a request that names nothing of it', async () => {
    await expect(deleteFleet({ requestId: 'r-1', fleetId: FLEET })).resolves.toEqual({ isOk: true, value: {} });

    expect(forgetter.forgotten).toEqual([FLEET]);
    expect(switches.held.has(FLEET)).toBe(false);
    expect(requests.held).toEqual([{ requestId: 'r-1', kind: 'deleteFleet', requestHash: plainHasher.hash(`deleteFleet ${FLEET}`), fleetId: null, isEnabled: null, at: AT }]);
  });

  it('answers a replayed request id with its first answer, forgetting nothing again', async () => {
    await deleteFleet({ requestId: 'r-1', fleetId: FLEET });

    await expect(deleteFleet({ requestId: 'r-1', fleetId: FLEET })).resolves.toEqual({ isOk: true, value: {} });
    expect(forgetter.forgotten).toEqual([FLEET]);
  });

  it('refuses a request id used for another request', async () => {
    await deleteFleet({ requestId: 'r-1', fleetId: FLEET });

    await expect(deleteFleet({ requestId: 'r-1', fleetId: OTHER })).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
    expect(forgetter.forgotten).toEqual([FLEET]);
  });
});

describe('deleting a fleet the networking plugin is connected to (decision 0035)', () => {
  it('unregisters at the fleet first: no plugin and no rules there, all-to-all', async () => {
    await expect(deleteFleet({ requestId: 'r-1', fleetId: FLEET })).resolves.toEqual({ isOk: true, value: {} });

    expect(parts.fleet.state.plugin).toBeNull();
    expect(parts.fleet.state.rules).toBeNull();
  });

  it('is refused while the fleet does not answer, forgetting nothing, so the same request id deletes it once the fleet answers', async () => {
    parts.fleet.state.isAnswering = false;

    await expect(deleteFleet({ requestId: 'r-1', fleetId: FLEET })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(forgetter.forgotten).toEqual([]);
    expect(requests.held).toEqual([]);

    parts.fleet.state.isAnswering = true;
    await expect(deleteFleet({ requestId: 'r-1', fleetId: FLEET })).resolves.toEqual({ isOk: true, value: {} });
    expect(parts.fleet.state.plugin).toBeNull();
    expect(forgetter.forgotten).toEqual([FLEET]);
  });

  it.each([
    ['its crew token no longer crews its ship', () => parts.fleet.state.liveTokens.clear()],
    ['its ship is not the plugin', () => (parts.fleet.state.plugin = null)],
  ])('goes on when the fleet says %s: nothing is left to unregister', async (_label, change) => {
    change();

    await expect(deleteFleet({ requestId: 'r-1', fleetId: FLEET })).resolves.toEqual({ isOk: true, value: {} });
    expect(forgetter.forgotten).toEqual([FLEET]);
  });
});
