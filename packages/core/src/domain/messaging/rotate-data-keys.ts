import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { FleetDataKeyMaker } from './data-keys.js';
import { dataKeyRotationCutoff, isDueANewDataKey } from './fleet-sealing.js';
import type { FleetSealingRepository } from './ports.js';

export interface RotateDataKeysTx {
  sealings: FleetSealingRepository;
  events: EventLog;
}

/** Makes a new data key current in every fleet whose current one is 30 days old; `onFleetError` (the pass always gives it) is told of a fleet whose rotation threw, and the pass goes on with the next fleet. */
export type RotateDataKeys = (onFleetError?: (fleetId: FleetId, error: unknown) => void) => Promise<void>;

/**
 * Use case: data keys by age (decision 0068, B13a), run by core in the 30
 * second pass, never through the API. Per sealed fleet whose current data key
 * is 30 days old, a new one is made under its company key outside every unit
 * of work; a key vault that refuses keeps the current key, its change of
 * availability written as any unwrap's (B11), and the next pass tries again.
 * Then one unit of work under the fleet's sealing lock taken with try (held:
 * another server rotates it now): the current key read again, so a server
 * that rotated it just before leaves it be, and the company key too, so a key
 * made under one the fleet changed from meanwhile is dropped; the new key
 * current, the old ones kept to unseal what they sealed, FleetDataKeyCreated.
 * No payload is sealed again.
 */
export function createRotateDataKeys(deps: {
  sealings: Pick<FleetSealingRepository, 'fleetsDueANewDataKey'>;
  uow: UnitOfWork<RotateDataKeysTx>;
  clock: Clock;
  ids: IdGenerator;
  dataKeys: FleetDataKeyMaker;
}): RotateDataKeys {
  const rotate = async (fleetId: FleetId) => {
    const made = await deps.dataKeys.make(fleetId);
    if (!made.isOk) {
      return;
    }
    const { companyKey, wrappedByCompanyKey, checkValue } = made.value;
    await deps.uow.run(async (tx) => {
      const { sealings } = tx;
      if (!(await sealings.tryLockSealing(fleetId))) {
        return ok(undefined);
      }
      const now = deps.clock.now();
      const sealing = await sealings.find(fleetId);
      if (sealing?.companyKey !== companyKey || !isDueANewDataKey(await sealings.dataKeyAges(fleetId), now)) {
        return ok(undefined);
      }
      const dataKeyId = deps.ids('dataKey');
      await sealings.addCurrentDataKey({ id: dataKeyId, fleetId, wrappedByCompanyKey, checkValue, createdAt: now, isCurrent: true });
      await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'FleetDataKeyCreated', occurredAt: now, actor: SYSTEM, details: { dataKeyId } });
      return ok(undefined);
    });
  };

  return async (onFleetError) => {
    for (const fleetId of await deps.sealings.fleetsDueANewDataKey(dataKeyRotationCutoff(deps.clock.now()))) {
      try {
        await rotate(fleetId);
      } catch (error) {
        onFleetError?.(fleetId, error);
      }
    }
  };
}
