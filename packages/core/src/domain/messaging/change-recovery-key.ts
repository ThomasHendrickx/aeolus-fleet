import type { DataKeyId, IdGenerator } from '@aeolus-fleet/common';

import { actorOf, hasScope, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { err, ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { PayloadSealing } from './data-keys.js';
import { keyUnavailable } from './key-unavailable.js';
import type { WrappedDataKey } from './key-vault.js';
import type { FleetSealingRepository } from './ports.js';
import { recoveryKey as recoveryKeyOf, type RecoveryKeys } from './recovery-key.js';

export interface ChangeRecoveryKeyTx {
  sealings: FleetSealingRepository;
  events: EventLog;
}

export interface RecoveryKeyChanged {
  recoveryKeyFingerprint: string;
}

export type ChangeRecoveryKeyRefusal = DomainError<'FORBIDDEN' | 'FLEET_NOT_SEALED' | 'INVALID_RECOVERY_KEY' | 'KEY_UNAVAILABLE'>;

export type ChangeRecoveryKey = (caller: Caller, input: { recoveryKey: string }) => Promise<Result<RecoveryKeyChanged, ChangeRecoveryKeyRefusal>>;

/** How often the wrapping runs again for data keys rotated while it ran, before the change is refused. */
const MAX_RUNS = 3;

/** A data key's wrap to the new recovery key. */
interface Rewrapped {
  id: DataKeyId;
  wrappedByRecoveryKey: WrappedDataKey;
}

/** The fleet's data keys changed between the wrapping and the swap: wrap again. */
interface KeysChanged {
  kind: 'keysChanged';
}

/**
 * Use case: changing a sealed fleet's recovery key (decision 0068, B13d), by
 * an actor holding `fleet:keys`, or setting one on a fleet sealed without.
 * Every data key is unwrapped through the company key, as a read unwraps it,
 * and wrapped to the new recovery key, outside every unit of work; a company
 * key that is not reachable refuses KEY_UNAVAILABLE. Then one unit of work
 * holds the fleet's sealing lock, so no rotation adds a key meanwhile, finds
 * the same data keys it wrapped, and swaps every recovery wrap and the
 * recovery key, FleetRecoveryKeyChanged naming both fingerprints; a key
 * rotated in between is wrapped again. Rolled back, every wrap stays as it
 * was. No payload is sealed again.
 */
export function createChangeRecoveryKey(deps: {
  uow: UnitOfWork<ChangeRecoveryKeyTx>;
  clock: Clock;
  ids: IdGenerator;
  recoveryKeys: RecoveryKeys;
  sealing: PayloadSealing;
  /** The fleets' sealing and data keys, read outside the unit of work. */
  sealings: FleetSealingRepository;
}): ChangeRecoveryKey {
  return async (caller, input) => {
    if (!hasScope(caller, 'fleet:keys')) {
      return refuse('FORBIDDEN', 'Changing the recovery key needs the fleet:keys scope');
    }
    const to = recoveryKeyOf(deps.recoveryKeys, input.recoveryKey);
    if (!to.isOk) {
      return to;
    }
    const { fleetId } = caller;
    if ((await deps.sealings.find(fleetId)) === undefined) {
      return refuse('FLEET_NOT_SEALED', `Fleet ${fleetId} is not sealed: turn sealing on with the recovery key instead`);
    }

    for (let run = 1; run <= MAX_RUNS; run += 1) {
      const dataKeyIds = (await deps.sealings.dataKeyAges(fleetId)).map(({ id }) => id);
      const unwrapped = await deps.sealing.dataKeys.unwrap(fleetId, dataKeyIds);
      if (!unwrapped.isOk) {
        return keyUnavailable(unwrapped.error);
      }
      const rewrapped: Rewrapped[] = [];
      for (const dataKey of unwrapped.value) {
        rewrapped.push({ id: dataKey.id, wrappedByRecoveryKey: await deps.recoveryKeys.wrap(to.value, dataKey.material) });
      }

      const swapped = await deps.uow.run(async (tx): Promise<Result<RecoveryKeyChanged, KeysChanged>> => {
        await tx.sealings.lockSealing(fleetId);
        const sealing = await tx.sealings.find(fleetId);
        const ids = new Set((await tx.sealings.dataKeyAges(fleetId)).map(({ id }) => id));
        if (sealing === undefined || ids.size !== rewrapped.length || rewrapped.some(({ id }) => !ids.has(id))) {
          return err({ kind: 'keysChanged' });
        }
        await tx.sealings.changeRecoveryKey(fleetId, { recoveryKey: to.value, dataKeys: rewrapped });
        const details = { from: sealing.recoveryKey?.fingerprint ?? null, to: to.value.fingerprint };
        await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'FleetRecoveryKeyChanged', occurredAt: deps.clock.now(), actor: actorOf(caller), details });
        return ok({ recoveryKeyFingerprint: to.value.fingerprint });
      });
      if (swapped.isOk) {
        return swapped;
      }
    }
    return refuse('KEY_UNAVAILABLE', "The fleet's data keys changed while this call ran: call again");
  };
}
