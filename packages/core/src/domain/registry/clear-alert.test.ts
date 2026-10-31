import type { RaiseAlertInput, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * Clearing alerts (decision 0071, docs/design/monitoring 4.5): the watch
 * clears an open alert once its fact moved back; a retire clears the ship's
 * open alerts, a release does not.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let watch: ShipCaller;
let deployBotId: ShipId;

function pingUnanswered(shipId: ShipId, occurrenceKey = 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1'): RaiseAlertInput {
  return {
    shipId,
    signal: 'ping-unanswered',
    occurrenceKey,
    since: '2026-10-31T14:31:00.000Z',
    facts: { deliveryId: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1', messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', minutes: 10 },
  };
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-31T14:53:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  const { shipId: watchId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'watch', type: 'watch', scopes: ['fleet:alert'] }));
  watch = { fleetId: fleet.fleetId, shipId: watchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:alert'] };
  ({ shipId: deployBotId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'deploy-bot', type: 'deployer' })));
  core.clock.advance(60_000);
});

describe('clearing an alert (decision 0071)', () => {
  it('clears the open alert at the time of the call, with AlertCleared on the ship by the watch', async () => {
    const raised = unwrap(await registry.raiseAlert(watch, pingUnanswered(deployBotId)));
    core.clock.advance(60_000);
    core.state.events.length = 0;

    await expect(registry.clearAlert(watch, { alertId: raised.id })).resolves.toEqual({ isOk: true, value: { ...raised, cleared: { at: core.clock.now(), why: 'cleared' } } });
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'AlertCleared',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: watch.shipId },
        shipId: deployBotId,
        details: { alertId: raised.id, signal: 'ping-unanswered', why: 'cleared' },
      }),
    ]);
  });

  it('answers a cleared alert as it is, changing nothing and writing no event', async () => {
    const raised = unwrap(await registry.raiseAlert(watch, pingUnanswered(deployBotId)));
    const cleared = unwrap(await registry.clearAlert(watch, { alertId: raised.id }));
    core.clock.advance(60_000);
    core.state.events.length = 0;

    await expect(registry.clearAlert(watch, { alertId: raised.id })).resolves.toEqual({ isOk: true, value: cleared });
    expect(core.state.events).toEqual([]);
  });

  it('refuses an alert that does not exist', async () => {
    await expect(registry.clearAlert(watch, { alertId: core.ids('alert') })).resolves.toMatchObject({ isOk: false, error: { kind: 'ALERT_NOT_FOUND' } });
  });
});

describe("clearing an alert outside the watch's read reach (decisions 0034, 0071)", () => {
  it('is refused as a read the rules do not allow, recording the refusal and leaving the alert open', async () => {
    const fleet = await readReachScenario();
    const raised = unwrap(await fleet.registry.raiseAlert({ ...fleet.argo, scopes: ['fleet:alert'] }, pingUnanswered(fleet.far.shipId)));
    await fleet.readRulesApply();
    fleet.core.state.reachRefusals.length = 0;
    fleet.core.state.events.length = 0;

    await expect(fleet.registry.clearAlert({ ...fleet.near, scopes: ['fleet:alert'] }, { alertId: raised.id })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this read' },
    });
    expect(fleet.core.state.alerts.map(({ cleared }) => cleared)).toEqual([null]);
    expect(fleet.core.state.events).toEqual([]);
  });
});

describe("a ship's alerts on its retire and release (decision 0071)", () => {
  it("clears the ship's open alerts when it retires, with AlertCleared, the ship retired; a cleared one stays as it was", async () => {
    const open = unwrap(await registry.raiseAlert(watch, pingUnanswered(deployBotId)));
    const clearedBefore = unwrap(await registry.clearAlert(watch, { alertId: unwrap(await registry.raiseAlert(watch, pingUnanswered(deployBotId, 'dlv_01m66p4k2v9qz8f7x3n5c1d1v2'))).id }));
    core.clock.advance(60_000);
    core.state.events.length = 0;

    unwrap(await registry.retireShip(argo, { shipId: deployBotId }));

    expect(core.state.alerts.map(({ id, cleared }) => ({ id, cleared }))).toEqual([
      { id: open.id, cleared: { at: core.clock.now(), why: 'retired' } },
      { id: clearedBefore.id, cleared: clearedBefore.cleared },
    ]);
    expect(core.state.events.filter(({ type }) => type === 'AlertCleared')).toEqual([
      expect.objectContaining({ actor: { kind: 'ship', shipId: argo.shipId }, shipId: deployBotId, details: { alertId: open.id, signal: 'ping-unanswered', why: 'retired' } }),
    ]);
  });

  it('keeps the open alerts of a ship that is released: an unacknowledged delivery waits on', async () => {
    unwrap(await registry.raiseAlert(watch, pingUnanswered(deployBotId)));
    crewAboard(core, { fleetId: argo.fleetId, shipId: deployBotId });
    unwrap(await registry.releaseShip(argo, { shipId: deployBotId }));

    expect(core.state.alerts.map(({ cleared }) => cleared)).toEqual([null]);
  });
});
