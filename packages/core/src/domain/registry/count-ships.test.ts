import type { CrewStatus, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

const MINUTE_MS = 60 * 1000;

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
});

async function commission(name: string): Promise<ShipId> {
  core.clock.advance(MINUTE_MS);
  return unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' })).shipId;
}

/** The ship asks to be kept crewed: unassigned, or assigned to a trierarch with the status given. */
function requestCrew(shipId: ShipId, assigned?: { to: ShipId; status: CrewStatus }): void {
  core.state.crewRequests.push({
    fleetId,
    shipId,
    settings: {},
    settingsVersion: 1,
    requestedAt: core.clock.now(),
    assignedTo: assigned?.to ?? null,
    status: assigned?.status ?? null,
    reason: null,
    attempt: 0,
    sessionStartedAt: null,
    isFinal: false,
    givenBack: [],
  });
}

async function agentCounts() {
  return (await registry.countShips(argo)).find((counts) => counts.kind === 'agent');
}

describe('counting the ships of the fleet', () => {
  it('counts argo as the one operator ship, active and crewed', async () => {
    await expect(registry.countShips(argo)).resolves.toEqual([
      { kind: 'operator', active: 1, crewed: 1, awaitingCrew: 0, retired: 0, needsCrew: { withTrierarchs: 0, withoutTrierarchs: 0 }, longestWait: null },
    ]);
  });

  it('counts the agent ships active, crewed, awaiting crew and retired', async () => {
    const scout = await commission('scout');
    await commission('lookout');
    const keeper = await commission('keeper');
    crewAboard(core, { fleetId, shipId: scout });
    unwrap(await registry.retireShip(argo, { shipId: keeper }));

    await expect(agentCounts()).resolves.toMatchObject({ active: 2, crewed: 1, awaitingCrew: 1, retired: 1 });
  });

  it('names the ship that has awaited crew longest, since its commission', async () => {
    const scout = await commission('scout');
    const commissionedAt = core.clock.now();
    await commission('lookout');

    await expect(agentCounts()).resolves.toMatchObject({ longestWait: { id: scout, name: 'scout', awaitingCrewSince: commissionedAt } });
  });

  it('counts a ship awaiting crew with an unassigned crew request as needing crew, with or without trierarchs', async () => {
    requestCrew(await commission('scout'));

    await expect(agentCounts()).resolves.toMatchObject({ needsCrew: { withTrierarchs: 1, withoutTrierarchs: 1 } });
  });

  it('counts a crew request assigned to a trierarch as needing crew only while it is not running or releasing', async () => {
    const trierarch = await commission('mac-studio');
    for (const status of ['crewing', 'restarting', 'crashed', 'running', 'releasing'] as const) {
      requestCrew(await commission(`scout-${status}`), { to: trierarch, status });
    }

    await expect(agentCounts()).resolves.toMatchObject({ needsCrew: { withTrierarchs: 3, withoutTrierarchs: 0 } });
  });

  it('does not count a ship crewed by hand as needing crew', async () => {
    const scout = await commission('scout');
    requestCrew(scout);
    unwrap(await registry.getStartingPrompt(argo, { shipId: scout }));
    core.clock.advance(MINUTE_MS);
    crewAboard(core, { fleetId, shipId: scout });

    await expect(agentCounts()).resolves.toMatchObject({ needsCrew: { withTrierarchs: 0, withoutTrierarchs: 0 } });
  });

  it('does not count a retired ship as needing crew', async () => {
    const scout = await commission('scout');
    requestCrew(scout);
    unwrap(await registry.retireShip(argo, { shipId: scout }));

    await expect(agentCounts()).resolves.toMatchObject({ needsCrew: { withTrierarchs: 0, withoutTrierarchs: 0 } });
  });

  it("counts only the ships in the caller's read reach (decision 0034)", async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    const readerFleet = await fleet.registry.countShips(fleet.reader);
    const argoFleet = await fleet.registry.countShips(fleet.argo);
    const total = (counts: typeof readerFleet) => counts.reduce((sum, kind) => sum + kind.active + kind.retired, 0);

    expect(total(readerFleet)).toBeLessThan(total(argoFleet));
    expect(total(argoFleet)).toBe((await fleet.registry.listFleet(fleet.argo)).ships.length);
    expect(total(readerFleet)).toBe((await fleet.registry.listFleet(fleet.reader)).ships.filter((ship) => !('isInReadReach' in ship)).length);
  });
});
