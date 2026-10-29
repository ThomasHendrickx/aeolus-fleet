import type { DataKeyId, IdGenerator } from '@aeolus-fleet/common';

import { actorOf, hasScope, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { err, ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkCompanyKey } from './company-key-check.js';
import { keyUnavailable } from './key-unavailable.js';
import type { CompanyKeyReference, KeyVault, WrappedDataKey } from './key-vault.js';
import type { PayloadSealer } from './payload-sealer.js';
import type { FleetSealingRepository } from './ports.js';

export interface RecoverKeysTx {
  sealings: FleetSealingRepository;
  events: EventLog;
}

/** A data key as the recovery command uploads it: wrapped under the new company key for this fleet. */
export interface RecoveredDataKey {
  readonly id: DataKeyId;
  readonly wrappedByCompanyKey: WrappedDataKey;
}

export interface KeysRecovered {
  companyKey: CompanyKeyReference;
}

export type RecoverKeysRefusal = DomainError<'FORBIDDEN' | 'FLEET_NOT_SEALED' | 'NO_RECOVERY_KEY' | 'RECOVERY_KEYS_MISMATCH' | 'KEY_UNAVAILABLE' | 'KEY_NOT_BOUND_TO_FLEET'>;

export type RecoverKeys = (caller: Caller, input: { companyKey: CompanyKeyReference; dataKeys: readonly RecoveredDataKey[] }) => Promise<Result<KeysRecovered, RecoverKeysRefusal>>;

/** The fleet's data keys or company key changed between the checks and the swap. */
interface KeysChanged {
  kind: 'keysChanged';
}

const MISMATCH_HINT = 'Nothing changed: run the recovery command again';

/**
 * Use case: recovering a sealed fleet's data keys under a new company key
 * (decision 0068, B15), by an actor holding `fleet:keys`, when the company
 * key is lost and the fleet has a recovery key. The recovery command opened
 * each data key with the offline recovery key on the company's computer and
 * wrapped it under the new company key in the company's KMS; no plain data
 * key reaches core. The new key is checked as at turning sealing on (B4).
 * The upload must name exactly the fleet's data keys, and each wrap must open
 * through the installation's grant on the new key to the key its check value
 * names; one that does not refuses the whole upload RECOVERY_KEYS_MISMATCH.
 * Every key vault call runs outside the unit of work. Then one unit of work
 * holds the fleet's sealing lock, finds the same company key and data keys,
 * and swaps every wrap and the reference, FleetKeysRecovered naming the new
 * key; a key rotated in between refuses KEY_UNAVAILABLE, to run again.
 * Rolled back, every wrap and the reference stay as they were. No payload is
 * sealed again.
 */
export function createRecoverKeys(deps: {
  uow: UnitOfWork<RecoverKeysTx>;
  clock: Clock;
  ids: IdGenerator;
  vault: KeyVault;
  sealer: PayloadSealer;
  /** The fleets' sealing and data keys, read outside the unit of work. */
  sealings: FleetSealingRepository;
}): RecoverKeys {
  return async (caller, { companyKey: to, dataKeys: uploaded }) => {
    if (!hasScope(caller, 'fleet:keys')) {
      return refuse('FORBIDDEN', 'Recovering the data keys needs the fleet:keys scope');
    }
    const { fleetId } = caller;
    const ages = await deps.sealings.dataKeyAges(fleetId);
    const stored = await deps.sealings.wrappedDataKeys(fleetId, ages.map(({ id }) => id));
    if (stored === undefined) {
      return refuse('FLEET_NOT_SEALED', `Fleet ${fleetId} is not sealed`);
    }
    if (stored.recoveryKey === null) {
      return refuse('NO_RECOVERY_KEY', `Fleet ${fleetId} was sealed without a recovery key: recovery is the company's KMS's own`);
    }
    const uploadedIds = new Set(uploaded.map(({ id }) => id));
    if (uploadedIds.size !== uploaded.length || uploadedIds.size !== stored.dataKeys.length || stored.dataKeys.some(({ id }) => !uploadedIds.has(id))) {
      return refuse('RECOVERY_KEYS_MISMATCH', `The upload must name each of the fleet's ${stored.dataKeys.length} data keys once. ${MISMATCH_HINT}`);
    }
    const checked = await checkCompanyKey(deps, { fleetId, companyKey: to });
    if (!checked.isOk) {
      return checked;
    }

    for (const { id, wrappedByCompanyKey } of uploaded) {
      const material = await deps.vault.unwrap({ fleetId, companyKey: to }, wrappedByCompanyKey);
      if (!material.isOk) {
        if (material.error.reason === 'invalidWrap') {
          return refuse('RECOVERY_KEYS_MISMATCH', `The wrap of data key ${id} does not open under ${to} for fleet ${fleetId}. ${MISMATCH_HINT}`);
        }
        return keyUnavailable(material.error);
      }
      const checkValue = stored.dataKeys.find((dataKey) => dataKey.id === id)?.checkValue;
      if (checkValue === undefined || !Buffer.from(deps.sealer.checkValue(material.value)).equals(checkValue)) {
        return refuse('RECOVERY_KEYS_MISMATCH', `The wrap of data key ${id} opens to another key than its check value names. ${MISMATCH_HINT}`);
      }
    }

    const from = stored.companyKey;
    const swapped = await deps.uow.run(async (tx): Promise<Result<KeysRecovered, KeysChanged>> => {
      await tx.sealings.lockSealing(fleetId);
      const sealing = await tx.sealings.find(fleetId);
      const ids = new Set((await tx.sealings.dataKeyAges(fleetId)).map(({ id }) => id));
      if (sealing?.companyKey !== from || ids.size !== uploadedIds.size || [...uploadedIds].some((id) => !ids.has(id))) {
        return err({ kind: 'keysChanged' });
      }
      await tx.sealings.changeCompanyKey(fleetId, { companyKey: to, dataKeys: uploaded });
      await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'FleetKeysRecovered', occurredAt: deps.clock.now(), actor: actorOf(caller), details: { companyKey: to } });
      return ok({ companyKey: to });
    });
    if (!swapped.isOk) {
      return refuse('KEY_UNAVAILABLE', "The fleet's data keys or company key changed while this call ran: run the recovery command again");
    }
    return swapped;
  };
}
