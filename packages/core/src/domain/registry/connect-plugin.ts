import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { connectPlugin, type ConnectPluginRefusal } from './plugin-connection.js';
import type { PluginConnectionRepository, ShipRepository } from './ports.js';

export interface ConnectPluginTx {
  ships: Pick<ShipRepository, 'findForUpdate'>;
  pluginConnections: PluginConnectionRepository;
  events: EventLog;
}

export type ConnectPluginUseCaseRefusal = DomainError<'NOT_THE_OPERATOR_SHIP' | 'SHIP_NOT_FOUND'> | ConnectPluginRefusal;

export type ConnectPlugin = (caller: ShipCaller, input: { shipId: ShipId }) => Promise<Result<undefined, ConnectPluginUseCaseRefusal>>;

/**
 * Use case: argo, and only argo, connects a ship as a plugin of its fleet,
 * as the console's Connect does (decision 0034): from then on the ship reads
 * every ship, whatever the rules, until a release or a retire of the ship
 * ends it. PluginConnected in the same unit of work. It holds the ship, as a
 * release and a retire do, so neither passes it by.
 */
export function createConnectPlugin(deps: { uow: UnitOfWork<ConnectPluginTx>; clock: Clock; ids: IdGenerator }): ConnectPlugin {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, ConnectPluginUseCaseRefusal>> => {
      if (caller.kind !== 'operator') {
        return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo connects a plugin');
      }
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, input.shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.shipId} does not exist`);
      }
      const connected = connectPlugin(ship, { current: await tx.pluginConnections.find(fleetId, ship.id), at: deps.clock.now(), actor: shipActor(caller.shipId) });
      if (!connected.isOk) {
        return connected;
      }
      if (connected.value.connection) {
        await tx.pluginConnections.connect(connected.value.connection);
      }
      for (const event of connected.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(undefined);
    });
}
