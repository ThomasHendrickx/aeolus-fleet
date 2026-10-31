import type { RaiseAlertInput, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * Alerts (decision 0071, docs/design/monitoring 4.5): the watch, a ship
 * holding fleet:alert, raises an alert on deploy-bot, which argo owns, once
 * per occurrence of a signal. Core holds it; the watch tells the owner.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let watch: ShipCaller;
let deployBotId: ShipId;

const DELIVERY_ID = 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1';
const MESSAGE_ID = 'msg_01m66p4k2v9qz8f7x3n5c1msg1';

function unacknowledged(occurrenceKey = DELIVERY_ID): RaiseAlertInput {
  return {
    shipId: deployBotId,
    signal: 'delivery-unacknowledged',
    occurrenceKey,
    since: '2026-10-31T14:31:00.000Z',
    facts: { deliveryId: DELIVERY_ID, messageId: MESSAGE_ID, state: 'pending', awaitingCrew: true, minutes: 15 },
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
  core.state.events.length = 0;
});

describe('raising an alert (decision 0071)', () => {
  it('holds an open alert on the ship: its signal and facts, the occurrence, since when, the owner told and when it was raised', async () => {
    const raised = unwrap(await registry.raiseAlert(watch, unacknowledged()));

    expect(raised).toEqual({
      id: expect.stringMatching(/^alt_/),
      ship: { id: deployBotId, name: 'deploy-bot' },
      signal: 'delivery-unacknowledged',
      facts: { deliveryId: DELIVERY_ID, messageId: MESSAGE_ID, state: 'pending', awaitingCrew: true, minutes: 15 },
      occurrenceKey: DELIVERY_ID,
      ownerShipId: argo.shipId,
      since: new Date('2026-10-31T14:31:00.000Z'),
      raisedAt: core.clock.now(),
      cleared: null,
    });
    expect(core.state.alerts.map(({ id }) => id)).toEqual([raised.id]);
  });

  it('writes AlertRaised on the ship, caused by the watch, naming the alert, the signal and the occurrence', async () => {
    const raised = unwrap(await registry.raiseAlert(watch, unacknowledged()));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'AlertRaised',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: watch.shipId },
        shipId: deployBotId,
        details: { alertId: raised.id, signal: 'delivery-unacknowledged', occurrenceKey: DELIVERY_ID },
      }),
    ]);
  });

  it('answers the alert already held for the same occurrence, raising no second one and writing no event', async () => {
    const first = unwrap(await registry.raiseAlert(watch, unacknowledged()));
    core.clock.advance(30_000);
    core.state.events.length = 0;

    await expect(registry.raiseAlert(watch, unacknowledged())).resolves.toEqual({ isOk: true, value: first });
    expect(core.state.alerts).toHaveLength(1);
    expect(core.state.events).toEqual([]);
  });

  it('never raises a cleared occurrence again: it answers the cleared alert', async () => {
    const first = unwrap(await registry.raiseAlert(watch, unacknowledged()));
    const cleared = unwrap(await registry.clearAlert(watch, { alertId: first.id }));
    core.state.events.length = 0;

    await expect(registry.raiseAlert(watch, unacknowledged())).resolves.toEqual({ isOk: true, value: cleared });
    expect(core.state.alerts).toHaveLength(1);
    expect(core.state.events).toEqual([]);
  });

  it('raises an alert of its own for another occurrence of the same signal on the ship', async () => {
    unwrap(await registry.raiseAlert(watch, unacknowledged()));

    unwrap(await registry.raiseAlert(watch, unacknowledged('dlv_01m66p4k2v9qz8f7x3n5c1d1v2')));

    expect(core.state.alerts.map(({ occurrenceKey }) => occurrenceKey)).toEqual([DELIVERY_ID, 'dlv_01m66p4k2v9qz8f7x3n5c1d1v2']);
  });

  it('names the owner of the ship at the time it is raised', async () => {
    const { shipId: ownerId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'orchestrator-1', type: 'orchestrator' }));
    unwrap(await registry.setOwner(argo, { shipId: deployBotId, ownerShipId: ownerId }));

    await expect(registry.raiseAlert(watch, unacknowledged())).resolves.toMatchObject({ isOk: true, value: { ownerShipId: ownerId } });
  });

  it('refuses a ship that does not exist', async () => {
    await expect(registry.raiseAlert(watch, { ...unacknowledged(), shipId: core.ids('ship') })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });

  it('refuses a retired ship, holding nothing and writing no event', async () => {
    unwrap(await registry.retireShip(argo, { shipId: deployBotId }));
    core.state.events.length = 0;

    await expect(registry.raiseAlert(watch, unacknowledged())).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_ALREADY_RETIRED' } });
    expect(core.state.alerts).toEqual([]);
    expect(core.state.events).toEqual([]);
  });
});

describe("raising an alert outside the watch's read reach (decisions 0034, 0071)", () => {
  it('is refused as a read the rules do not allow, recording the refusal and holding no alert', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    fleet.core.state.reachRefusals.length = 0;
    fleet.core.state.events.length = 0;
    const alerting: ShipCaller = { ...fleet.near, scopes: ['fleet:alert'] };

    await expect(fleet.registry.raiseAlert(alerting, { ...unacknowledged(), shipId: fleet.far.shipId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this read' },
    });
    expect(fleet.core.state.alerts).toEqual([]);
    expect(fleet.core.state.events).toEqual([]);
    expect(fleet.core.state.reachRefusals.map(({ verb }) => verb)).toEqual(['read']);
  });
});
