/** Records one counted read and any transition atomically on its plugin ship. */
import type { IdGenerator, RecordPluginReadInput } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkRead, keepingReachRefusal, type CheckReadTx, type NotReachable } from './check-reach.js';
import { applyPluginRead } from './plugin-reads.js';
import type { ShipRepository } from './ports.js';

interface RecordPluginReadTx extends Omit<CheckReadTx, 'ships'> {
  ships: Pick<ShipRepository, 'find' | 'findForUpdate' | 'savePluginReads'>;
  events: EventLog;
}

export interface CountedPluginReadFailure {
  plugin: string;
  read: string;
  reason: Extract<RecordPluginReadInput, { outcome: 'failed' }>['reason'];
}

type RecordPluginReadRefusal = DomainError<'PLUGIN_NOT_FOUND'> | NotReachable;
export type RecordPluginRead = (caller: Caller, input: RecordPluginReadInput) => Promise<Result<undefined, RecordPluginReadRefusal>>;

export function createRecordPluginRead(deps: {
  uow: UnitOfWork<RecordPluginReadTx>;
  clock: Clock;
  ids: IdGenerator;
  countFailure(failure: CountedPluginReadFailure): void;
}): RecordPluginRead {
  return async (caller, input) => {
    const { fleetId } = caller;
    const { pluginShipId: shipId } = input;
    const result = await keepingReachRefusal(deps.uow, async (tx): Promise<Result<string, RecordPluginReadRefusal>> => {
      // A second record or a retire uses the same lock and observes the state this call commits.
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      const at = deps.clock.now();
      const applied = applyPluginRead(ship, { read: input, at, actor: actorOf(caller) });
      if (!applied.isOk) {
        return applied;
      }
      const reached = await checkRead({ tx, ids: deps.ids }, { reader: caller, askedBy: null, shipId, at });
      if (!reached.isOk) {
        return reached;
      }
      await tx.ships.savePluginReads({ fleetId, shipId, pluginReads: applied.value.state.pluginReads });
      for (const event of applied.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok(applied.value.state.type);
    });
    if (!result.isOk) {
      return result;
    }
    if (input.outcome === 'failed') {
      deps.countFailure({ plugin: result.value, read: input.read, reason: input.reason });
    }
    return ok(undefined);
  };
}
