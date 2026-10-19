import type { Discovered } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { reaching, rulesInForceAt, shipAsItIs, type CheckReachTx } from './check-reach.js';
import { allowsReach } from './network-settings.js';
import type { LeaseRepository, ShipRepository } from './ports.js';
import { discoveredStatementOf } from './statement.js';

export interface DiscoverTx {
  networkSettings: CheckReachTx['networkSettings'];
  ships: Pick<ShipRepository, 'find' | 'listActive'>;
  labels: CheckReachTx['labels'];
  pluginConnections: CheckReachTx['pluginConnections'];
  leases: Pick<LeaseRepository, 'findLastSeen' | 'listOpenStatements'>;
}

export type Discover = (caller: ShipCaller) => Promise<Result<Discovered, never>>;

/**
 * Use case: a ship asks which ships and types it may send to now (decision
 * 0047), its scope (messages:send) checked before this runs. Each active
 * ship but the caller and the viewer is checked as a send to it would be at
 * this moment (decision 0034): the rules in force, what the networking plugin
 * declared while it does not respond, the built-in rules; there is no message,
 * so no answer to a sender. Each reached ship comes with its name, type, kind,
 * status and statement, and each type with how many of its ships it reaches.
 * Ships, never rules; it records nothing, a refusal included.
 */
export function createDiscover(deps: { uow: UnitOfWork<DiscoverTx>; clock: Clock }): Discover {
  return (caller) =>
    deps.uow.run(async (tx): Promise<Result<Discovered, never>> => {
      const { fleetId } = caller;
      const settings = await tx.networkSettings.findForShare(fleetId);
      const inForce = await rulesInForceAt(tx, { settings, now: deps.clock.now() });
      const active = await tx.ships.listActive(fleetId);
      const callerShip = active.find((ship) => ship.id === caller.shipId);
      const sender = callerShip === undefined ? undefined : reaching(await shipAsItIs(tx, callerShip));
      const crews = new Map((await tx.leases.listOpenStatements(fleetId)).map(({ shipId, stated }) => [shipId, stated]));
      const ships: Discovered['ships'] = [];
      for (const ship of active) {
        if (ship.id === caller.shipId || ship.kind === 'viewer' || sender === undefined) {
          continue;
        }
        const recipient = reaching(await shipAsItIs(tx, ship));
        if (!allowsReach(inForce, { verb: 'send', sender, recipient, isAnswerToSender: false })) {
          continue;
        }
        const isCrewed = ship.kind === 'operator' || crews.has(ship.id);
        ships.push({
          id: ship.id,
          name: ship.name,
          type: ship.type,
          kind: ship.kind,
          status: isCrewed ? 'crewed' : 'awaitingCrew',
          statement: discoveredStatementOf(ship, crews.get(ship.id) ?? null),
        });
      }
      return ok({ ships, types: typesOf(ships) });
    });
}

/** Each type of the reached ships with how many of them, in the order the ships come. */
function typesOf(ships: Discovered['ships']): Discovered['types'] {
  const counts = new Map<string, number>();
  for (const ship of ships) {
    counts.set(ship.type, (counts.get(ship.type) ?? 0) + 1);
  }
  return [...counts].map(([type, reachable]) => ({ type, reachable }));
}
