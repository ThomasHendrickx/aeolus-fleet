import type { AlertId, RaiseAlertInput, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * The fleet's open alerts (decision 0071, docs/design/monitoring 4.5, 4.8):
 * the overview's Open alerts, newest first, a page at a time, read beside
 * fleet.list; cleared ones leave the list.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let watch: ShipCaller;
let deployBotId: ShipId;
let mergerId: ShipId;

function pingUnanswered(shipId: ShipId, occurrenceKey: string): RaiseAlertInput {
  return {
    shipId,
    signal: 'ping-unanswered',
    occurrenceKey,
    since: '2026-10-31T14:31:00.000Z',
    facts: { deliveryId: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1', messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', minutes: 10 },
  };
}

async function raised(shipId: ShipId, occurrenceKey: string): Promise<AlertId> {
  core.clock.advance(1_000);
  return unwrap(await registry.raiseAlert(watch, pingUnanswered(shipId, occurrenceKey))).id;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-31T14:53:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  watch = { ...argo, scopes: ['fleet:alert'] };
  ({ shipId: deployBotId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'deploy-bot', type: 'deployer' })));
  ({ shipId: mergerId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'merger-1', type: 'merger' })));
});

describe("the fleet's open alerts (decision 0071)", () => {
  it('are the open ones, newest first, each on its ship by name; a cleared one leaves the list', async () => {
    const first = await raised(deployBotId, 'a');
    const cleared = await raised(mergerId, 'b');
    const newest = await raised(mergerId, 'c');
    unwrap(await registry.clearAlert(watch, { alertId: cleared }));

    const { items, nextCursor } = await registry.readOpenAlerts(argo);

    expect(items.map(({ id, ship }) => ({ id, ship }))).toEqual([
      { id: newest, ship: { id: mergerId, name: 'merger-1' } },
      { id: first, ship: { id: deployBotId, name: 'deploy-bot' } },
    ]);
    expect(nextCursor).toBeNull();
  });

  it('come a page at a time, the next page after the cursor the last one answered', async () => {
    const [oldest, middle, newest] = [await raised(deployBotId, 'a'), await raised(deployBotId, 'b'), await raised(deployBotId, 'c')];

    const first = await registry.readOpenAlerts(argo, { limit: 2 });
    const second = await registry.readOpenAlerts(argo, { limit: 2, cursor: first.nextCursor ?? undefined });

    expect([first.items.map(({ id }) => id), first.nextCursor]).toEqual([[newest, middle], middle]);
    expect([second.items.map(({ id }) => id), second.nextCursor]).toEqual([[oldest], null]);
  });

  it("leave out the alerts on ships outside the reader's read reach (decision 0034)", async () => {
    const fleet = await readReachScenario();
    const alerting: ShipCaller = { ...fleet.argo, scopes: ['fleet:alert'] };
    const onNear = unwrap(await fleet.registry.raiseAlert(alerting, pingUnanswered(fleet.near.shipId, 'a'))).id;
    unwrap(await fleet.registry.raiseAlert(alerting, pingUnanswered(fleet.far.shipId, 'b')));
    await fleet.readRulesApply();

    const { items, nextCursor } = await fleet.registry.readOpenAlerts(fleet.reader);

    expect([items.map(({ id }) => id), nextCursor]).toEqual([[onNear], null]);
  });
});

describe("a ship's open alerts (decision 0071, docs/design/monitoring 4.8)", () => {
  it('are on its page, newest first, a cleared one left out', async () => {
    const older = await raised(mergerId, 'a');
    const cleared = await raised(mergerId, 'b');
    const newer = await raised(mergerId, 'c');
    await raised(deployBotId, 'd');
    unwrap(await registry.clearAlert(watch, { alertId: cleared }));

    const merger = unwrap(await registry.getShip(argo, { shipId: mergerId }));

    expect('openAlerts' in merger ? merger.openAlerts.map(({ id }) => id) : undefined).toEqual([newer, older]);
  });

  it('are counted on each ship as the fleet lists it', async () => {
    await raised(mergerId, 'a');
    await raised(mergerId, 'b');
    unwrap(await registry.clearAlert(watch, { alertId: await raised(deployBotId, 'c') }));

    const { ships } = await registry.listFleet(argo);

    expect(ships.map((ship) => ({ name: ship.name, openAlertCount: 'openAlertCount' in ship ? ship.openAlertCount : undefined }))).toEqual([
      { name: 'argo', openAlertCount: 0 },
      { name: 'deploy-bot', openAlertCount: 0 },
      { name: 'merger-1', openAlertCount: 2 },
    ]);
  });
});
