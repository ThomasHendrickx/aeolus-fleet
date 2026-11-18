/** One discovery destination, without enumerating destinations or reading message history. */
import type { LookupInput, LookedUpShip } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { reaching, rulesInForceOf, shipAsItIs, type CheckReachTx } from './check-reach.js';
import { discoveredStatementOf } from './statement.js';
import { allowsReach } from './network-settings.js';
import type { LeaseRepository, ShipRepository } from './ports.js';

interface LookupTx {
  ships: Pick<ShipRepository, 'find' | 'findActiveByName'>;
  leases: Pick<LeaseRepository, 'findOpenSummary' | 'findOpenStatement'>;
  networkSettings: CheckReachTx['networkSettings'];
  declaredNetworkRules: CheckReachTx['declaredNetworkRules'];
  labels: CheckReachTx['labels'];
}

export type Lookup = (caller: ShipCaller, input: LookupInput) => Promise<Result<LookedUpShip, never>>;

/** Scope is checked at the API door. No reply exception or refusal record; the description has no commission-note fallback. */
export function createLookup(deps: { uow: UnitOfWork<LookupTx> }): Lookup {
  return (caller, input) => deps.uow.run(async (tx) => {
    const { fleetId } = caller;
    const settings = await tx.networkSettings.findForShare(fleetId);
    const rules = await rulesInForceOf(tx, settings);
    const ship = input.id === undefined
      ? await tx.ships.findActiveByName(fleetId, input.name ?? '')
      : await tx.ships.find(fleetId, input.id);
    if (ship?.retiredAt !== null || ship.removedAt !== null || ship.id === caller.shipId || ship.kind === 'viewer') {
      return ok(null);
    }
    const sender = await tx.ships.find(fleetId, caller.shipId);
    if (sender?.retiredAt !== null) {
      return ok(null);
    }
    const [from, to] = await Promise.all([shipAsItIs(tx, sender), shipAsItIs(tx, ship)]);
    if (!allowsReach(rules, { verb: 'send', sender: reaching(from), recipient: reaching(to), isAnswerToSender: false })) {
      return ok(null);
    }
    const summary = (await tx.leases.findOpenSummary(fleetId, ship.id))?.trim() ?? '';
    const description = summary === '' ? null : (/^[\s\S]*?[.!?](?=\s|$)/u.exec(summary)?.[0] ?? summary);
    return ok({ id: ship.id, name: ship.name, description,
      ...(input.includeStatement === true ? { statement: discoveredStatementOf(ship, await tx.leases.findOpenStatement(fleetId, ship.id)) } : {}),
    });
  });
}
