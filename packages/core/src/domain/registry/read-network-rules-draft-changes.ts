import { NETWORK_VERBS, type NetworkRulesDraftChanges } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { reaching, rulesInForceOf, shipAsItIs } from './check-reach.js';
import { draftInForce, type ExplainReachTx } from './explain-reach.js';
import { refuseNoDraft, type NoNetworkRulesDraft } from './network-rules-draft.js';
import { reachRuleOf } from './network-settings.js';
import { readsShip, type ReadReachOf } from './read-reach.js';

export type ReadNetworkRulesDraftChangesTx = ExplainReachTx;

export type ReadNetworkRulesDraftChanges = (caller: Caller) => Promise<Result<NetworkRulesDraftChanges, NoNetworkRulesDraft>>;

/**
 * Use case: any actor holding fleet:network asks what applying the fleet's
 * draft would change (decision 0034), checked before this runs: per verb,
 * every pair of active ships it reads where the draft lets one reach the
 * other and the applied rules do not, with the draft's rule, and where the
 * applied rules do and the draft does not, with the applied rule. Both
 * beside the declared rules as they are now; there is no message, so no
 * answer to a sender. It records nothing.
 */
export function createReadNetworkRulesDraftChanges(deps: { uow: UnitOfWork<ReadNetworkRulesDraftChangesTx>; readReach: ReadReachOf }): ReadNetworkRulesDraftChanges {
  return async (caller) => {
    const reads = await deps.readReach(caller);
    return deps.uow.run(async (tx): Promise<Result<NetworkRulesDraftChanges, NoNetworkRulesDraft>> => {
      const { fleetId } = caller;
      const drafted = await draftInForce(tx, fleetId);
      if (drafted === undefined) {
        return refuseNoDraft();
      }
      const applied = await rulesInForceOf(tx, await tx.networkSettings.findForShare(fleetId));
      const ships = [];
      for (const ship of await tx.ships.listActive(fleetId)) {
        if (ship.kind !== 'viewer' && readsShip(reads, ship.id)) {
          ships.push(reaching(await shipAsItIs(tx, ship)));
        }
      }
      const changes: NetworkRulesDraftChanges = { send: { gained: [], lost: [] }, read: { gained: [], lost: [] }, manage: { gained: [], lost: [] } };
      for (const sender of ships) {
        for (const recipient of ships.filter((ship) => ship.id !== sender.id)) {
          for (const verb of NETWORK_VERBS) {
            const reach = { verb, sender, recipient, isAnswerToSender: false };
            const [now, then] = [reachRuleOf(applied, reach), reachRuleOf(drafted, reach)];
            const pair = { fromShipId: sender.id, toShipId: recipient.id };
            if (now === undefined && then !== undefined) {
              changes[verb].gained.push({ ...pair, rule: then });
            }
            if (now !== undefined && then === undefined) {
              changes[verb].lost.push({ ...pair, rule: now });
            }
          }
        }
      }
      return ok(changes);
    });
  };
}
