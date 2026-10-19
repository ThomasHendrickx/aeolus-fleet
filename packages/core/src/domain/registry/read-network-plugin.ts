import type { ShipId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { NetworkSettingsRepository } from './ports.js';

export interface ReadNetworkPluginTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
}

export interface RegisteredNetworkPlugin {
  shipId: ShipId;
  registeredAt: Date;
}

export type ReadNetworkPlugin = (caller: ShipCaller) => Promise<Result<RegisteredNetworkPlugin | null, never>>;

/**
 * Use case: the caller's fleet's networking plugin, its ship and when it
 * registered, or none (decision 0035): the gateway switches on for a fleet
 * only while it has one (interop I-3). Its scope (fleet:read) is checked
 * before this runs. Read under the shared settings lock, so it answers one
 * version.
 */
export function createReadNetworkPlugin(deps: { uow: UnitOfWork<ReadNetworkPluginTx> }): ReadNetworkPlugin {
  return (caller) =>
    deps.uow.run(async (tx): Promise<Result<RegisteredNetworkPlugin | null, never>> => {
      const { plugin } = await tx.networkSettings.findForShare(caller.fleetId);
      return ok(plugin === null ? null : { shipId: plugin.shipId, registeredAt: plugin.registeredAt });
    });
}
