import type { ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { reaching, rulesInForceAt, shipAsItIs, type CheckReachTx } from './check-reach.js';
import { allowsReach } from './network-settings.js';
import type { ShipRepository } from './ports.js';

export interface ExplainReachTx {
  networkSettings: CheckReachTx['networkSettings'];
  ships: Pick<ShipRepository, 'find' | 'listActive'>;
  labels: CheckReachTx['labels'];
  leases: CheckReachTx['leases'];
}

export type ExplainReachFailure = DomainError<'NOT_THE_OPERATOR_SHIP' | 'SHIP_NOT_FOUND'>;

export type ExplainReach = (
  caller: Caller,
  input: { fromShipId: ShipId; toShipId?: ShipId },
) => Promise<Result<{ reachableShipIds: ShipId[] }, ExplainReachFailure>>;

/**
 * Use case: argo asks which ships a ship reaches now, or whether it reaches
 * one ship (design points 11 and 12 on #260). It answers as a send would be
 * checked at this moment: the rules in force, what the networking plugin
 * declared while it does not respond, argo both ways. There is no message, so
 * no answer to a sender. It answers the ships, never the rules or the reasons,
 * and records nothing: an explain is not a send. Only argo; the viewer ship
 * receives nothing, so it is never reached.
 */
export function createExplainReach(deps: { uow: UnitOfWork<ExplainReachTx>; clock: Clock }): ExplainReach {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ reachableShipIds: ShipId[] }, ExplainReachFailure>> => {
      if (caller.kind !== 'operator') {
        return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo explains reach');
      }
      const { fleetId } = caller;
      const from = await tx.ships.find(fleetId, input.fromShipId);
      if (from?.retiredAt !== null) {
        return refuse('SHIP_NOT_FOUND', 'The fleet has no active ship with this id to explain from');
      }
      const active = await tx.ships.listActive(fleetId);
      const others = active.filter((ship) => ship.id !== from.id && (input.toShipId === undefined || ship.id === input.toShipId));
      if (input.toShipId !== undefined && others.length === 0 && input.toShipId !== from.id) {
        return refuse('SHIP_NOT_FOUND', 'The fleet has no active ship with this id to explain reach to');
      }
      const settings = await tx.networkSettings.findForShare(fleetId);
      const inForce = await rulesInForceAt(tx, { settings, now: deps.clock.now() });
      const sender = reaching(await shipAsItIs(tx, from));
      const reachableShipIds: ShipId[] = [];
      for (const ship of others) {
        const recipient = reaching(await shipAsItIs(tx, ship));
        if (allowsReach(inForce, { sender, recipient, isAnswerToSender: false })) {
          reachableShipIds.push(ship.id);
        }
      }
      return ok({ reachableShipIds });
    });
}
