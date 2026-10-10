import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { suppliedFleet } from '../../../test/support/supplied-fleet.js';
import { createSetFleetEnabled } from './set-fleet-enabled.js';

const FLEET: FleetId = FLEET_ID;
const AT = new Date('2026-10-04T12:00:00.000Z');

let parts: Awaited<ReturnType<typeof suppliedFleet>>;
let switches: Awaited<ReturnType<typeof suppliedFleet>>['switches'];
let requests: ReturnType<typeof memoryInstallationRequests>;
let setEnabled: ReturnType<typeof createSetFleetEnabled>;

beforeEach(async () => {
  parts = await suppliedFleet('enabled');
  ({ switches } = parts);
  requests = memoryInstallationRequests();
  setEnabled = createSetFleetEnabled({ switches, requests, hasher: plainHasher, clock: { now: () => AT }, supplies: parts.supplies });
});

describe("switching the networking plugin on or off for a fleet", () => {
  it('turns it on, and off again', async () => {
    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: true } });
    expect(switches.held.get(FLEET)).toBe(true);

    await expect(setEnabled({ requestId: 'r-2', fleetId: FLEET, isEnabled: false })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: false } });
    expect(switches.held.get(FLEET)).toBe(false);
  });

  it('answers a replayed request id with its first answer, and changes nothing again', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true });
    await setEnabled({ requestId: 'r-2', fleetId: FLEET, isEnabled: false });

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: true } });
    expect(switches.held.get(FLEET)).toBe(false);
  });

  it('refuses a request id used for another request', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: true });

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET, isEnabled: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
    expect(switches.held.get(FLEET)).toBe(true);
  });
});

describe('switching the networking plugin on or off acts on the fleet at once (Thomas on #260)', () => {
  const RULES = [{ from: [], to: [] }];

  beforeEach(async () => {
    await setEnabled({ requestId: 'r-on', fleetId: FLEET, isEnabled: true });
    await parts.networks.save(FLEET, { rules: RULES, declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 } });
    await parts.supplies.supply(FLEET);
  });

  it('switched off, it unregisters: no plugin and no rules at the fleet, all-to-all', async () => {
    await setEnabled({ requestId: 'r-off', fleetId: FLEET, isEnabled: false });

    expect(parts.fleet.state.plugin).toBeNull();
    expect(parts.fleet.state.rules).toBeNull();
  });

  it('switched on again, it registers with what argo declared and supplies the rules it kept', async () => {
    await setEnabled({ requestId: 'r-off', fleetId: FLEET, isEnabled: false });

    await setEnabled({ requestId: 'r-on-again', fleetId: FLEET, isEnabled: true });

    expect(parts.fleet.state.plugin).toEqual({ whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 });
    expect(parts.fleet.state.rules).toEqual(RULES);
  });

  it('keeps the switch while the fleet does not answer, and a retry unregisters it once the fleet answers', async () => {
    parts.fleet.state.isAnswering = false;

    await expect(setEnabled({ requestId: 'r-off', fleetId: FLEET, isEnabled: false })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET, isEnabled: false } });
    expect(switches.held.get(FLEET)).toBe(false);
    parts.fleet.state.isAnswering = true;
    await parts.supplies.retry();

    expect(parts.fleet.state.plugin).toBeNull();
  });
});
