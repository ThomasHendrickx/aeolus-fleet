import { NETWORK_VERBS, type ExplainedReach, type ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { reaching, rulesInForceOf, shipAsItIs, type CheckReachTx } from './check-reach.js';
import { refuseNoDraft, type NoNetworkRulesDraft } from './network-rules-draft.js';
import { reachRuleOf, rulesInForce, type RulesInForce } from './network-settings.js';
import { readsShip, type ReadReachOf } from './read-reach.js';
import type { NetworkRulesDraftRepository, ShipRepository } from './ports.js';

export interface ExplainReachTx {
  networkSettings: CheckReachTx['networkSettings'];
  ships: Pick<ShipRepository, 'find' | 'listActive'>;
  labels: CheckReachTx['labels'];
  declaredNetworkRules: CheckReachTx['declaredNetworkRules'];
  networkRulesDrafts: Pick<NetworkRulesDraftRepository, 'find'>;
}

export type ExplainReachFailure = DomainError<'NOT_REACHABLE' | 'SHIP_NOT_FOUND'> | NoNetworkRulesDraft;

export type ExplainReach = (caller: Caller, input: { fromShipId: ShipId; toShipId?: ShipId; against?: 'applied' | 'draft' }) => Promise<Result<ExplainedReach, ExplainReachFailure>>;

/**
 * Use case: an actor asks which ships a ship reaches now, per verb, or
 * whether it reaches one ship (decision 0034). It answers as a send would be
 * checked at this moment: the built-in rules, the fleet's own rules and the
 * declared ones; or, asked of the draft, as one would be checked once the
 * draft is applied. Each ship comes with the rule that allows it: a built-in
 * rule, one of the fleet's own by its place, or a declared rule by its
 * declarer and place. There is no message, so no answer to a sender. It
 * records nothing: an explain is not a send. Any actor holding fleet:explain
 * asks, the scope checked before this runs, about the ships it reads
 * (decision 0053).
 */
export function createExplainReach(deps: { uow: UnitOfWork<ExplainReachTx>; readReach: ReadReachOf }): ExplainReach {
  return async (caller, input) => {
    const reads = await deps.readReach(caller);
    return deps.uow.run(async (tx): Promise<Result<ExplainedReach, ExplainReachFailure>> => {
      const { fleetId } = caller;
      const from = await tx.ships.find(fleetId, input.fromShipId);
      if (from?.retiredAt !== null) {
        return refuse('SHIP_NOT_FOUND', 'The fleet has no active ship with this id to explain from');
      }
      if (!readsShip(reads, from.id)) {
        return refuse('NOT_REACHABLE', 'The network rules do not let you read the ship to explain from');
      }
      const active = await tx.ships.listActive(fleetId);
      const others = active.filter((ship) => ship.id !== from.id && readsShip(reads, ship.id) && (input.toShipId === undefined || ship.id === input.toShipId));
      if (input.toShipId !== undefined && others.length === 0 && input.toShipId !== from.id) {
        return refuse('SHIP_NOT_FOUND', 'The fleet has no active ship with this id to explain reach to');
      }
      const inForce = input.against === 'draft' ? await draftInForce(tx, fleetId) : await rulesInForceOf(tx, await tx.networkSettings.findForShare(fleetId));
      if (inForce === undefined) {
        return refuseNoDraft();
      }
      const sender = reaching(await shipAsItIs(tx, from));
      const explained: ExplainedReach = { send: [], read: [], manage: [] };
      for (const ship of others) {
        const recipient = reaching(await shipAsItIs(tx, ship));
        for (const verb of NETWORK_VERBS) {
          const rule = reachRuleOf(inForce, { verb, sender, recipient, isAnswerToSender: false });
          if (rule !== undefined) {
            explained[verb].push({ shipId: ship.id, rule });
          }
        }
      }
      return ok(explained);
    });
  };
}

/** The rules that would be in force once the fleet's draft is applied, with the declared ones as they are now; none without a draft. */
export async function draftInForce(
  tx: Pick<ExplainReachTx, 'networkSettings' | 'declaredNetworkRules' | 'networkRulesDrafts'>,
  fleetId: Caller['fleetId'],
): Promise<RulesInForce | undefined> {
  const settings = await tx.networkSettings.findForShare(fleetId);
  const draft = await tx.networkRulesDrafts.find(fleetId);
  if (draft === undefined) {
    return undefined;
  }
  return rulesInForce({ rules: draft.rules, isViewerReadOn: settings.isViewerReadOn }, await tx.declaredNetworkRules.list(fleetId));
}
