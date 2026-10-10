import type { IdGenerator, NetworkPluginDeclaration } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { registerNetworkPlugin, type RegisterNetworkPluginRefusal } from './network-settings.js';
import type { NetworkSettingsRepository } from './ports.js';

export interface RegisterNetworkPluginTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForUpdate' | 'save'>;
  events: EventLog;
}

export type RegisterNetworkPlugin = (caller: Caller, input: NetworkPluginDeclaration) => Promise<Result<{ version: number }, RegisterNetworkPluginRefusal>>;

/**
 * Use case: the caller's ship becomes the fleet's networking plugin, saying
 * what happens to sends while it is unavailable and after how long without a
 * call it is not responding (decision 0035). Its scope (fleet:network) is
 * checked before this runs. In one unit of work, holding the settings
 * exclusively as a set of rules does: the settings at their next version,
 * and NetworkPluginRegistered.
 */
export function createRegisterNetworkPlugin(deps: { uow: UnitOfWork<RegisterNetworkPluginTx>; clock: Clock; ids: IdGenerator }): RegisterNetworkPlugin {
  return (caller, declaration) =>
    deps.uow.run(async (tx): Promise<Result<{ version: number }, RegisterNetworkPluginRefusal>> => {
      const current = await tx.networkSettings.findForUpdate(caller.fleetId);
      const registered = registerNetworkPlugin(current, { shipId: caller.shipId, declaration, at: deps.clock.now(), actor: shipActor(caller.shipId) });
      if (!registered.isOk) {
        return registered;
      }
      await tx.networkSettings.save(registered.value.settings);
      for (const event of registered.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ version: registered.value.settings.version });
    });
}
