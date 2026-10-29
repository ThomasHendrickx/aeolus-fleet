/**
 * Sealing and unsealing payloads inside a use case (decision 0068, B8, B9).
 * No key vault call runs inside a unit of work: the work seals and unseals
 * with the data keys it holds, and when it meets one it does not hold it
 * answers which it needs, so its unit of work rolls back, storing and
 * claiming nothing. The keys are then unwrapped outside it and the work runs
 * again with them; a key the vault does not give refuses KEY_UNAVAILABLE.
 */
import { payloadBytes, type DataKeyId, type FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { err, ok, type Result } from '../shared/result.js';
import { keyUnavailable } from './key-unavailable.js';
import type { KeyUnavailable, KeyVault } from './key-vault.js';
import type { DataKey, PayloadSealer, SealedRow } from './payload-sealer.js';
import type { Message } from './message.js';
import type { FleetSealingRepository } from './ports.js';
import { isSealedPayload, type StoredPayload } from './sealed-payload.js';

/** The work met data keys it does not hold: its unit of work rolls back, and it runs again with them. */
export interface DataKeysNeeded {
  readonly kind: 'dataKeysNeeded';
  readonly dataKeyIds: readonly DataKeyId[];
}

/** What a unit of work seals and unseals with: the sealer, and the fleet's data keys unwrapped before it began. */
export interface HeldDataKeys {
  readonly sealer: PayloadSealer;
  readonly keys: ReadonlyMap<DataKeyId, DataKey>;
}

/** Unwraps a fleet's data keys through its company key, outside every unit of work. */
export interface FleetDataKeys {
  unwrap(fleetId: FleetId, dataKeyIds: readonly DataKeyId[]): Promise<Result<DataKey[], KeyUnavailable>>;
}

/** What a use case seals and unseals payloads with. */
export interface PayloadSealing {
  readonly sealer: PayloadSealer;
  readonly dataKeys: FleetDataKeys;
}

/** How often the work runs again for keys it met: each run holds every key the runs before it met. */
const MAX_RUNS = 3;

export function isDataKeysNeeded(error: unknown): error is DataKeysNeeded {
  return typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'dataKeysNeeded';
}

/**
 * The fleet's data keys from their wraps, each checked against its check
 * value, so a vault that answered another key is refused as a wrap that
 * does not open.
 */
export function createFleetDataKeys(deps: { sealings: Pick<FleetSealingRepository, 'wrappedDataKeys'>; vault: KeyVault; sealer: PayloadSealer }): FleetDataKeys {
  return {
    unwrap: async (fleetId, dataKeyIds) => {
      const wrapped = await deps.sealings.wrappedDataKeys(fleetId, dataKeyIds);
      if (wrapped?.dataKeys.length !== dataKeyIds.length) {
        return err({ kind: 'keyUnavailable', reason: 'notFound' });
      }
      const unwrapped: DataKey[] = [];
      for (const dataKey of wrapped.dataKeys) {
        const material = await deps.vault.unwrap({ fleetId, companyKey: wrapped.companyKey }, dataKey.wrappedByCompanyKey);
        if (!material.isOk) {
          return material;
        }
        if (!Buffer.from(deps.sealer.checkValue(material.value)).equals(dataKey.checkValue)) {
          return err({ kind: 'keyUnavailable', reason: 'invalidWrap' });
        }
        unwrapped.push({ id: dataKey.id, material: material.value });
      }
      return ok(unwrapped);
    },
  };
}

/**
 * Runs the work, holding no key at first, and again with the keys it met,
 * unwrapped outside its unit of work. A fleet that is not sealed never meets
 * one, so its work runs once and the key vault is never called.
 */
export async function withDataKeys<T, E>(
  of: { sealing: PayloadSealing; fleetId: FleetId },
  work: (held: HeldDataKeys) => Promise<Result<T, E | DataKeysNeeded>>,
): Promise<Result<T, E | DomainError<'KEY_UNAVAILABLE'>>> {
  const { sealing, fleetId } = of;
  const keys = new Map<DataKeyId, DataKey>();
  for (let run = 1; ; run += 1) {
    const outcome = await work({ sealer: sealing.sealer, keys });
    if (outcome.isOk) {
      return outcome;
    }
    const { error } = outcome;
    if (!isDataKeysNeeded(error)) {
      return err(error);
    }
    if (run === MAX_RUNS) {
      return refuse('KEY_UNAVAILABLE', "The fleet's data keys changed while this call ran: call again");
    }
    const unwrapped = await sealing.dataKeys.unwrap(fleetId, error.dataKeyIds.filter((id) => !keys.has(id)));
    if (!unwrapped.isOk) {
      return keyUnavailable(unwrapped.error);
    }
    for (const dataKey of unwrapped.value) {
      keys.set(dataKey.id, dataKey);
    }
  }
}

/** The payload sealed under the fleet's current data key, or plain in a fleet that has none. */
export function sealedFor(held: HeldDataKeys, sealing: { currentDataKeyId: DataKeyId | undefined; row: SealedRow; payload: string }): Result<StoredPayload, DataKeysNeeded> {
  const { currentDataKeyId, row, payload } = sealing;
  if (currentDataKeyId === undefined) {
    return ok(payload);
  }
  const key = held.keys.get(currentDataKeyId);
  if (key === undefined) {
    return err({ kind: 'dataKeysNeeded', dataKeyIds: [currentDataKeyId] });
  }
  return ok({ sealed: held.sealer.seal({ key, row }, payload), plainBytes: payloadBytes(payload) });
}

/** The plain payload of a stored one; a sealed payload that does not open for its row refuses KEY_UNAVAILABLE. */
export function unsealed(held: HeldDataKeys, stored: { row: SealedRow; payload: StoredPayload }): Result<string, DataKeysNeeded | DomainError<'KEY_UNAVAILABLE'>> {
  const { row, payload } = stored;
  if (!isSealedPayload(payload)) {
    return ok(payload);
  }
  const key = held.keys.get(payload.sealed.dataKeyId);
  if (key === undefined) {
    return err({ kind: 'dataKeysNeeded', dataKeyIds: [payload.sealed.dataKeyId] });
  }
  const opened = held.sealer.unseal({ key, row }, payload.sealed);
  return opened.isOk ? opened : refuse('KEY_UNAVAILABLE', `The sealed payload of ${row.rowId} does not open under its data key`);
}

/** The message as the fleet stores it: sealed in a sealed fleet, under its current data key, with the request hash that leaves the payload out. */
export async function sealedMessage(
  deps: { tx: { sealings: Pick<FleetSealingRepository, 'currentDataKeyId'> }; held: HeldDataKeys | undefined },
  accepted: { message: Message; sealedRequestHash: string },
): Promise<Result<Message, DataKeysNeeded>> {
  const { message, sealedRequestHash } = accepted;
  if (deps.held === undefined || typeof message.payload !== 'string') {
    return ok(message);
  }
  const currentDataKeyId = await deps.tx.sealings.currentDataKeyId(message.fleetId);
  const payload = sealedFor(deps.held, { currentDataKeyId, row: { fleetId: message.fleetId, rowId: message.id }, payload: message.payload });
  if (!payload.isOk) {
    return payload;
  }
  return ok(typeof payload.value === 'string' ? message : { ...message, payload: payload.value, requestHash: sealedRequestHash });
}
