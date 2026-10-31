import type { ReportTask } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, crewAboard, everyShipMay } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { unwrap } from '../../testing/result.js';
import type { Crew } from '../shared/caller.js';
import type { ShipDetail } from './get-ship.js';

/**
 * Expectations on a ship (decision 0071, docs/design/monitoring 4.7): an
 * actor with fleet:manage within manage reach sets them through the ship
 * API, standing on the ship, and reads them back with the ship. The
 * orchestrator carries team a and holds fleet:manage; the rules let team a
 * manage team a. near carries team a, far team b, and argo owns both, so
 * the orchestrator is not their owner.
 */
let fleet: ReadReachScenario;
let orchestrator: Crew;

const PULL_REQUEST: ReportTask = { kind: 'url', url: 'https://github.com/ThomasHendrickx/aeolus-fleet/pull/1391' };
const ISSUE: ReportTask = { kind: 'url', url: 'https://github.com/ThomasHendrickx/aeolus-fleet/issues/1407' };
const SIX_PM = new Date('2026-10-18T18:00:00.000Z');

beforeEach(async () => {
  fleet = await readReachScenario();
  const caller = await shipWithScopes({ registry: fleet.registry, argo: fleet.argo }, { name: 'orchestrator', type: 'orchestrator', scopes: ['fleet:manage'] });
  orchestrator = { ...crewAboard(fleet.core, caller), scopes: caller.scopes };
  await fleet.carry(orchestrator, 'a');
  await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: [{ verb: 'manage', from: [fleet.team('a')], to: [fleet.team('a')] }, everyShipMay('send'), everyShipMay('read')] });
  fleet.core.state.reachRefusals.length = 0;
  fleet.core.clock.advance(60_000);
  fleet.core.state.events.length = 0;
});

/** The ship's expectations as argo reads them back with the ship; argo reads every ship. */
async function expectationsOn(shipId: Crew['shipId']): Promise<ShipDetail['expectations'] | undefined> {
  const ship = unwrap(await fleet.registry.getShip(fleet.argo, { shipId }));
  return 'expectations' in ship ? ship.expectations : undefined;
}

describe('setting expectations on a ship (decision 0071)', () => {
  it('lets a non-owner a manage rule lets reach the ship set them, read back with the ship, each naming who set it and when', async () => {
    await expect(
      fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, reportChangesWithin: 60, taskDoneBy: { task: PULL_REQUEST, doneBy: SIX_PM } }),
    ).resolves.toEqual({ isOk: true, value: undefined });

    const setBy = { kind: 'ship', shipId: orchestrator.shipId };
    await expect(expectationsOn(fleet.near.shipId)).resolves.toEqual({
      reportChangesWithin: { minutes: 60, setBy, setAt: fleet.core.clock.now() },
      taskDoneBy: { task: PULL_REQUEST, doneBy: SIX_PM, setBy, setAt: fleet.core.clock.now() },
    });
    expect(fleet.core.state.reachRefusals).toEqual([]);
  });

  it('writes ExpectationsSet on the ship in the same unit of work, caused by the setter, with what now holds', async () => {
    unwrap(await fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, reportChangesWithin: 60, taskDoneBy: { task: PULL_REQUEST, doneBy: SIX_PM } }));

    expect(fleet.core.state.events).toEqual([
      expect.objectContaining({
        type: 'ExpectationsSet',
        occurredAt: fleet.core.clock.now(),
        actor: { kind: 'ship', shipId: orchestrator.shipId },
        shipId: fleet.near.shipId,
        details: { reportChangesWithin: 60, taskDoneBy: SIX_PM.toISOString(), taskKind: 'url' },
      }),
    ]);
  });

  it('keeps an expectation left out, with who set it and when, and clears one set to null', async () => {
    unwrap(await fleet.registry.setExpectations(fleet.argo, { shipId: fleet.near.shipId, reportChangesWithin: 60 }));
    const setAt = fleet.core.clock.now();
    fleet.core.clock.advance(60_000);

    unwrap(await fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, taskDoneBy: { task: ISSUE, doneBy: SIX_PM } }));
    await expect(expectationsOn(fleet.near.shipId)).resolves.toEqual({
      reportChangesWithin: { minutes: 60, setBy: { kind: 'ship', shipId: fleet.argo.shipId }, setAt },
      taskDoneBy: { task: ISSUE, doneBy: SIX_PM, setBy: { kind: 'ship', shipId: orchestrator.shipId }, setAt: fleet.core.clock.now() },
    });

    unwrap(await fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, reportChangesWithin: null, taskDoneBy: null }));
    await expect(expectationsOn(fleet.near.shipId)).resolves.toEqual({ reportChangesWithin: null, taskDoneBy: null });
    expect(fleet.core.state.events.at(-1)).toMatchObject({ type: 'ExpectationsSet', details: { reportChangesWithin: null, taskDoneBy: null, taskKind: null } });
  });

  it('changes nothing and writes no event when the same expectations are set again', async () => {
    unwrap(await fleet.registry.setExpectations(fleet.argo, { shipId: fleet.near.shipId, reportChangesWithin: 60, taskDoneBy: { task: PULL_REQUEST, doneBy: SIX_PM } }));
    const before = await expectationsOn(fleet.near.shipId);
    fleet.core.clock.advance(60_000);
    fleet.core.state.events.length = 0;

    unwrap(await fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, reportChangesWithin: 60, taskDoneBy: { task: { url: PULL_REQUEST.url, kind: 'url' }, doneBy: SIX_PM } }));

    await expect(expectationsOn(fleet.near.shipId)).resolves.toEqual(before);
    expect(fleet.core.state.events).toEqual([]);
  });

  it('reads none on a ship no one set expectations on', async () => {
    await expect(expectationsOn(fleet.near.shipId)).resolves.toEqual({ reportChangesWithin: null, taskDoneBy: null });
  });

  it('refuses a task done by whose task does not check out, changing nothing', async () => {
    await expect(
      fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, reportChangesWithin: 60, taskDoneBy: { task: { kind: 'url', url: 'http://example.com' }, doneBy: SIX_PM } }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_REPORT_TASK' } });

    await expect(expectationsOn(fleet.near.shipId)).resolves.toEqual({ reportChangesWithin: null, taskDoneBy: null });
    expect(fleet.core.state.events).toEqual([]);
  });

  it('refuses report changes within outside 5 to 10080 minutes, changing nothing', async () => {
    for (const minutes of [4, 10_081, 7.5]) {
      await expect(fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, reportChangesWithin: minutes })).resolves.toMatchObject({
        isOk: false,
        error: { kind: 'INVALID_EXPECTATIONS' },
      });
    }
    expect(fleet.core.state.events).toEqual([]);
  });

  it('refuses a ship that does not exist', async () => {
    await expect(fleet.registry.setExpectations(orchestrator, { shipId: fleet.core.ids('ship'), reportChangesWithin: 60 })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });

  it('refuses a retired ship, storing nothing', async () => {
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.near.shipId }));
    fleet.core.state.events.length = 0;

    await expect(fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, reportChangesWithin: 60 })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_ALREADY_RETIRED' },
    });
    expect(fleet.core.state.expectations).toEqual([]);
    expect(fleet.core.state.events).toEqual([]);
  });
});

describe('setting expectations outside manage reach (decisions 0034, 0071)', () => {
  it('is refused as a manage the rules do not allow, recording the refusal and storing nothing', async () => {
    await expect(fleet.registry.setExpectations(orchestrator, { shipId: fleet.far.shipId, reportChangesWithin: 60 })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this manage' },
    });

    await expect(expectationsOn(fleet.far.shipId)).resolves.toEqual({ reportChangesWithin: null, taskDoneBy: null });
    expect(fleet.core.state.events).toEqual([]);
    expect(fleet.core.state.reachRefusals.map(({ verb }) => verb)).toEqual(['manage']);
  });
});

describe('expectations through release and retire (decision 0071)', () => {
  it('keeps them through a release', async () => {
    unwrap(await fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, reportChangesWithin: 60 }));

    unwrap(await fleet.registry.releaseShip(fleet.argo, { shipId: fleet.near.shipId }));

    await expect(expectationsOn(fleet.near.shipId)).resolves.toMatchObject({ reportChangesWithin: { minutes: 60 } });
  });

  it('removes them when the ship retires', async () => {
    unwrap(await fleet.registry.setExpectations(orchestrator, { shipId: fleet.near.shipId, reportChangesWithin: 60, taskDoneBy: { task: PULL_REQUEST, doneBy: SIX_PM } }));

    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.near.shipId }));

    expect(fleet.core.state.expectations).toEqual([]);
    await expect(expectationsOn(fleet.near.shipId)).resolves.toEqual({ reportChangesWithin: null, taskDoneBy: null });
  });
});
