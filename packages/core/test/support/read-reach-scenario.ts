import type { FleetId, LabelValueId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { Caller, Crew } from '../../src/domain/shared/caller.js';
import type { Selector } from '../../src/domain/shared/selector.js';
import { addViewerShip, crewAboard, historyUseCases, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases } from './core-fixtures.js';
import { shipWithScopes } from './crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from './in-memory.js';
import { valueIdOf } from './label-fixtures.js';
import { newKey } from './keys.js';
import { unwrap } from './result.js';

/**
 * A fleet for read reach (decision 0034): reader, with fleet:read, and near
 * (type reviewer) carry team a; far (type keeper) carries team b. The
 * networking plugin is registered; until `readRulesApply`, open is on for
 * every verb. The fleet has its viewer ship. Every agent ship is crewed.
 */
export interface ReadReachScenario {
  core: InMemoryCore;
  fleetId: FleetId;
  argo: Caller;
  viewer: Caller;
  reader: Crew;
  near: Crew;
  far: Crew;
  networking: Crew;
  registry: ReturnType<typeof registryUseCases>;
  messaging: ReturnType<typeof messagingUseCases>;
  history: ReturnType<typeof historyUseCases>;
  team(value: 'a' | 'b'): LabelValueId;
  /** The plugin's rules: team a reads team a; open stays on for send and manage, off for read. */
  readRulesApply(): Promise<void>;
  send(from: Caller, to: Selector): Promise<MessageId>;
}

export async function readReachScenario(): Promise<ReadReachScenario> {
  const core = createInMemoryCore('2026-10-18T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  const { fleetId } = fleet;
  const argo = operatorCaller(fleet);
  const viewer: Caller = { fleetId, shipId: addViewerShip(core, { fleetId }).shipId, kind: 'viewer', scopes: ['fleet:read'] };
  const registry = registryUseCases(core);
  const messaging = messagingUseCases(core);
  const crewed = async (ship: { name: string; type: string; scopes: Parameters<typeof shipWithScopes>[1]['scopes'] }): Promise<Crew> => {
    const caller = await shipWithScopes({ registry, argo }, ship);
    return { ...crewAboard(core, caller), scopes: caller.scopes };
  };
  const labeller = await shipWithScopes({ registry, argo }, { name: 'labeller', type: 'labeller', scopes: ['labels:define', 'labels:assign'] });
  const reader = await crewed({ name: 'reader', type: 'reader', scopes: ['fleet:read'] });
  const near = await crewed({ name: 'near', type: 'reviewer', scopes: [] });
  const far = await crewed({ name: 'far', type: 'keeper', scopes: [] });
  const networking = await crewed({ name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  unwrap(await registry.registerNetworkPlugin(networking, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 }));
  unwrap(await registry.defineLabel(labeller, { key: 'team', values: ['a', 'b'] }));
  const team = (value: 'a' | 'b'): LabelValueId => valueIdOf(core, { key: 'team', value });
  for (const [ship, value] of [
    [reader, 'a'],
    [near, 'a'],
    [far, 'b'],
  ] as const) {
    unwrap(await registry.assignLabel(labeller, { shipId: ship.shipId, valueId: team(value) }));
  }

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
    readRulesApply: async () => {
      unwrap(await registry.setNetworkRules(networking, { rules: [{ verb: 'read', from: [team('a')], to: [team('a')] }] }));
      unwrap(await registry.setBuiltInRule(networking, { rule: 'open', verb: 'read', isOn: false }));
    },
    send: async (from, to) => {
      core.clock.advance(1_000);
      const { messageId } = unwrap(
        await messaging.sendMessage(from, { selector: to, payload: 'Review the pull request', contentType: 'text/plain', ...modelOf(from), idempotencyKey: newKey() }),
      );
      return messageId;
    },
  };
}

/** The ships by id, sorted, as a read reach's set compares. */
export function idsOf(...ships: { shipId: ShipId }[]): ShipId[] {
  return ships.map((ship) => ship.shipId).sort();
}
