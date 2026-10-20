import type { DeliveryId, FleetId, LabelValueId, MessageId, ShipId } from '@aeolus-fleet/common';

import { UNDELIVERABLE_AT_ATTEMPT } from '../../src/domain/messaging/delivery.js';

import type { ShipCaller, Crew } from '../../src/domain/shared/caller.js';
import type { Selector } from '../../src/domain/shared/selector.js';
import { addViewerShip, applyNetworkRules, crewAboard, everyShipMay, deliveryIdOf, historyUseCases, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases } from './core-fixtures.js';
import { shipWithScopes } from './crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from './in-memory.js';
import { valueIdOf } from './label-fixtures.js';
import { newKey } from '../../src/testing/keys.js';
import { unwrap } from '../../src/testing/result.js';

/**
 * A fleet for read reach (decision 0034): reader, with fleet:read, and near
 * (type reviewer) carry team a; far (type keeper) carries team b.
 * networking holds fleet:network; until `readRulesApply`, the fleet has no
 * rules applied, so open is on for every verb. The fleet has its viewer ship. Every agent ship is crewed.
 */
export interface ReadReachScenario {
  core: InMemoryCore;
  fleetId: FleetId;
  argo: ShipCaller;
  viewer: ShipCaller;
  reader: Crew;
  near: Crew;
  far: Crew;
  networking: Crew;
  registry: ReturnType<typeof registryUseCases>;
  messaging: ReturnType<typeof messagingUseCases>;
  history: ReturnType<typeof historyUseCases>;
  team(value: 'a' | 'b'): LabelValueId;
  /** The ship carries team a or b, as the label's owner assigns it. */
  carry(ship: { shipId: ShipId }, value: 'a' | 'b'): Promise<void>;
  /** The rules applied: team a reads team a; every ship still sends to and manages every ship. */
  readRulesApply(): Promise<void>;
  send(from: ShipCaller, to: Selector): Promise<MessageId>;
  /** A message from one ship to a crewed one, received without acknowledging it until undeliverable: its delivery. */
  undeliverable(from: ShipCaller, to: Crew): Promise<DeliveryId>;
}

export async function readReachScenario(): Promise<ReadReachScenario> {
  const core = createInMemoryCore('2026-10-18T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  const { fleetId } = fleet;
  const argo = operatorCaller(fleet);
  const viewer: ShipCaller = { fleetId, shipId: addViewerShip(core, { fleetId }).shipId, kind: 'viewer', scopes: ['fleet:read'] };
  const registry = registryUseCases(core);
  const messaging = messagingUseCases(core);
  const crewed = async (ship: { name: string; type: string; scopes: Parameters<typeof shipWithScopes>[1]['scopes'] }): Promise<Crew> => {
    const caller = await shipWithScopes({ registry, argo }, ship);
    return { ...crewAboard(core, caller), scopes: caller.scopes };
  };
  // argo labels the ships: it labels any ship (decision 0046).
  const labeller = argo;
  const reader = await crewed({ name: 'reader', type: 'reader', scopes: ['fleet:read'] });
  const near = await crewed({ name: 'near', type: 'reviewer', scopes: [] });
  const far = await crewed({ name: 'far', type: 'keeper', scopes: [] });
  const networking = await crewed({ name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  unwrap(await registry.defineLabel(labeller, { key: 'team', values: ['a', 'b'] }));
  const team = (value: 'a' | 'b'): LabelValueId => valueIdOf(core, { key: 'team', value });
  for (const [ship, value] of [
    [reader, 'a'],
    [near, 'a'],
    [far, 'b'],
  ] as const) {
    unwrap(await registry.assignLabel(labeller, { shipId: ship.shipId, valueId: team(value) }));
  }

  const send = async (from: ShipCaller, to: Selector): Promise<MessageId> => {
    core.clock.advance(1_000);
    const { messageId } = unwrap(
      await messaging.sendMessage(from, { selector: to, payload: 'Review the pull request', contentType: 'text/plain', ...modelOf(from), idempotencyKey: newKey() }),
    );
    return messageId;
  };

  return {
    core,
    fleetId,
    argo,
    viewer,
    reader,
    near,
    far,
    networking,
    registry,
    messaging,
    history: historyUseCases(core),
    team,
    carry: async (ship, value) => {
      unwrap(await registry.assignLabel(labeller, { shipId: ship.shipId, valueId: team(value) }));
    },
    readRulesApply: async () => {
      await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'read', from: [team('a')], to: [team('a')] }, everyShipMay('send'), everyShipMay('manage')] });
    },
    send,
    undeliverable: async (from, to) => {
      const deliveryId = deliveryIdOf(core, await send(from, { kind: 'ship', shipId: to.shipId }));
      for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
        unwrap(await messaging.receiveDeliveries(to, {}));
      }
      return deliveryId;
    },
  };
}

/** The ships by id, sorted, as a read reach's set compares. */
export function idsOf(...ships: { shipId: ShipId }[]): ShipId[] {
  return ships.map((ship) => ship.shipId).sort();
}
