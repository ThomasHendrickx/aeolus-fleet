import type { IdGenerator } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { discardNetworkRulesDraft, type NoNetworkRulesDraft } from './network-rules-draft.js';
import type { NetworkRulesDraftRepository } from './ports.js';

export interface DiscardNetworkRulesDraftTx {
  networkRulesDrafts: Pick<NetworkRulesDraftRepository, 'find' | 'remove'>;
  events: EventLog;
}

export type DiscardNetworkRulesDraft = (caller: Caller) => Promise<Result<undefined, NoNetworkRulesDraft>>;

/**
 * Use case: any actor holding fleet:network discards the fleet's draft
 * (decision 0034), checked before this runs. In one unit of work: the draft
 * gone, and NetworkRulesDraftDiscarded. The applied rules stay as they are.
 */
export function createDiscardNetworkRulesDraft(deps: { uow: UnitOfWork<DiscardNetworkRulesDraftTx>; clock: Clock; ids: IdGenerator }): DiscardNetworkRulesDraft {
  return (caller) =>
    deps.uow.run(async (tx): Promise<Result<undefined, NoNetworkRulesDraft>> => {
      const { fleetId } = caller;
      const discarded = discardNetworkRulesDraft(await tx.networkRulesDrafts.find(fleetId), { fleetId, at: deps.clock.now(), actor: actorOf(caller) });
      if (!discarded.isOk) {
        return discarded;
      }
      await tx.networkRulesDrafts.remove(fleetId);
      for (const event of discarded.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
