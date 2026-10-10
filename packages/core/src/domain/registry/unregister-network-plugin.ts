import type { IdGenerator } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { unregisterNetworkPlugin, type NotTheNetworkPlugin } from './network-settings.js';
import type { NetworkSettingsRepository } from './ports.js';

export interface UnregisterNetworkPluginTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForUpdate' | 'save'>;
  events: EventLog;
}

export type UnregisterNetworkPlugin = (caller: Caller) => Promise<Result<{ version: number }, NotTheNetworkPlugin>>;

/**
 * Use case: the fleet's networking plugin unregisters, as it does when it is
 * switched off or deleted for the fleet (decision 0035): no plugin and no
 * rules, all-to-all. Its scope (fleet:network) is checked before this runs.
 * In one unit of work, holding the settings exclusively: the settings at
 * their next version, and NetworkPluginUnregistered.
 */
export function createUnregisterNetworkPlugin(deps: { uow: UnitOfWork<UnregisterNetworkPluginTx>; clock: Clock; ids: IdGenerator }): UnregisterNetworkPlugin {
  return (caller) =>
    deps.uow.run(async (tx): Promise<Result<{ version: number }, NotTheNetworkPlugin>> => {
      const current = await tx.networkSettings.findForUpdate(caller.fleetId);
      const unregistered = unregisterNetworkPlugin(current, { shipId: caller.shipId, at: deps.clock.now(), actor: shipActor(caller.shipId) });
      if (!unregistered.isOk) {
        return unregistered;
      }
      await tx.networkSettings.save(unregistered.value.settings);
      for (const event of unregistered.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ version: unregistered.value.settings.version });
    });
}
