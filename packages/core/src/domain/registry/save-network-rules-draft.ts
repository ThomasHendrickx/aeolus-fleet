import type { IdGenerator } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { saveNetworkRulesDraft } from './network-rules-draft.js';
import type { InvalidNetworkRules, NetworkRule } from './network-settings.js';
import type { NetworkRulesDraftRepository, NetworkSettingsRepository } from './ports.js';

export interface SaveNetworkRulesDraftTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
  networkRulesDrafts: Pick<NetworkRulesDraftRepository, 'save'>;
  events: EventLog;
}

export type SaveNetworkRulesDraft = (caller: Caller, input: { rules: readonly NetworkRule[] | null }) => Promise<Result<{ savedAgainstVersion: number }, InvalidNetworkRules>>;

/**
 * Use case: any actor holding fleet:network saves the draft of the fleet's
 * own rules, a whole list or none for all-to-all (decisions 0034, 0053),
 * checked before this runs. In one unit of work: the draft in place of the
 * one before, against the settings version as it is, and
 * NetworkRulesDraftSaved. Nothing in force changes, so the settings are only
 * read, shared.
 */
export function createSaveNetworkRulesDraft(deps: { uow: UnitOfWork<SaveNetworkRulesDraftTx>; clock: Clock; ids: IdGenerator }): SaveNetworkRulesDraft {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<{ savedAgainstVersion: number }, InvalidNetworkRules>> => {
      const settings = await tx.networkSettings.findForShare(caller.fleetId);
      const saved = saveNetworkRulesDraft(settings, { rules: input.rules, at: deps.clock.now(), actor: actorOf(caller) });
      if (!saved.isOk) {
        return saved;
      }
      await tx.networkRulesDrafts.save(saved.value.draft);
      for (const event of saved.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ savedAgainstVersion: saved.value.draft.savedAgainstVersion });
    });
}
