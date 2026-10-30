import type { IdGenerator } from '@aeolus-fleet/common';

import { checkFeatureFlag, isFeatureFlagOnForUpdate, requireFeatureFlag, type FeatureFlagReads, type FeatureFlagRepository } from '../registry/public.js';
import { actorOf, hasScope, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { SealingState } from './fleet-sealing.js';
import { checkCompanyKey } from './company-key-check.js';
import type { CompanyKeyReference, KeyVault } from './key-vault.js';
import type { PayloadSealer } from './payload-sealer.js';
import { recoveryKey as recoveryKeyOf, type RecoveryKey, type RecoveryKeys } from './recovery-key.js';
import type { FleetSealingRepository } from './ports.js';

export interface TurnOnSealingTx {
  sealings: FleetSealingRepository;
  featureFlags: Pick<FeatureFlagRepository, 'isOnForUpdate'>;
  events: EventLog;
}

export interface SealingTurnedOn {
  state: SealingState;
  companyKey: CompanyKeyReference;
  /** The recovery key's fingerprint, when the company gave one. */
  recoveryKeyFingerprint?: string;
}

export type TurnOnSealingRefusal = DomainError<'FORBIDDEN' | 'FEATURE_FLAG_OFF' | 'FLEET_ALREADY_SEALED' | 'INVALID_RECOVERY_KEY' | 'KEY_UNAVAILABLE' | 'KEY_NOT_BOUND_TO_FLEET'>;

export type TurnOnSealing = (caller: Caller, input: { companyKey: CompanyKeyReference; recoveryKey?: string }) => Promise<Result<SealingTurnedOn, TurnOnSealingRefusal>>;

/**
 * Use case: turning sealing on for the caller's fleet (decision 0068, B4),
 * by an actor holding `fleet:keys`, as the fleet manager does, optionally
 * with a recovery key (B6). Checked in order: the caller's scope; that the
 * fleet's sealing flag is on (decision 0069), read again with its row held in
 * the unit of work; that a
 * recovery key given is an `age` X25519 recipient; that the fleet is not
 * sealed; that the
 * company's key vault makes a data key under the company key for this
 * fleet's context and unwraps it again; and that it refuses one for another
 * fleet's context, so a key whose policy has no fleet condition, which one
 * tenant could point at another's key with, is refused
 * KEY_NOT_BOUND_TO_FLEET. Every key vault call runs before the unit of work;
 * a refusal or no answer is KEY_UNAVAILABLE with its reason, and nothing is
 * stored. The first data key is wrapped to the recovery key too, outside it.
 * Then one unit of work: the fleet sealed under its company key with its
 * recovery key, its first data key current, FleetSealingTurnedOn naming the
 * key reference and the recovery key's fingerprint, and no key material. A fleet that stores a plain payload reads sealing
 * until the sealing pass leaves none; one that stores none reads sealed.
 */
export function createTurnOnSealing(deps: {
  uow: UnitOfWork<TurnOnSealingTx>;
  clock: Clock;
  ids: IdGenerator;
  vault: KeyVault;
  sealer: PayloadSealer;
  recoveryKeys: RecoveryKeys;
  /** The fleets' sealing, read outside the unit of work. */
  sealings: FleetSealingRepository;
  /** The fleets' feature flags: sealing's procedures refuse a fleet whose sealing flag is off (decision 0069). */
  featureFlags: FeatureFlagReads;
}): TurnOnSealing {
  return async (caller, input) => {
    const { companyKey } = input;
    if (!hasScope(caller, 'fleet:keys')) {
      return refuse('FORBIDDEN', 'Turning sealing on needs the fleet:keys scope');
    }
    let recoveryKey: RecoveryKey | null = null;
    if (input.recoveryKey !== undefined) {
      const parsed = recoveryKeyOf(deps.recoveryKeys, input.recoveryKey);
      if (!parsed.isOk) {
        return parsed;
      }
      recoveryKey = parsed.value;
    }
    const { fleetId } = caller;
    const offered = await checkFeatureFlag(deps.featureFlags, { fleetId, flag: 'sealing' });
    if (!offered.isOk) {
      return offered;
    }
    if ((await deps.sealings.find(fleetId)) !== undefined) {
      return refuse('FLEET_ALREADY_SEALED', `Fleet ${fleetId} is sealed already`);
    }
    const made = await checkCompanyKey(deps, { fleetId, companyKey });
    if (!made.isOk) {
      return made;
    }
    const checkValue = deps.sealer.checkValue(made.value.unwrapped);
    const wrappedByRecoveryKey = recoveryKey === null ? null : await deps.recoveryKeys.wrap(recoveryKey, made.value.unwrapped);
    // Counted outside the unit of work, so a fleet with a long history keeps its sends going while it counts.
    const toSeal = await deps.sealings.plainPayloadCount(fleetId);
    const turnedOn: Pick<SealingTurnedOn, 'companyKey' | 'recoveryKeyFingerprint'> = recoveryKey === null ? { companyKey } : { companyKey, recoveryKeyFingerprint: recoveryKey.fingerprint };

    return deps.uow.run(async (tx): Promise<Result<SealingTurnedOn, TurnOnSealingRefusal>> => {
      // Held until sealing is on, so the flag cannot go off while the fleet turns sealing on (decision 0069).
      const stillOffered = requireFeatureFlag('sealing', await isFeatureFlagOnForUpdate({ source: deps.featureFlags.source, flags: tx.featureFlags }, { fleetId, flag: 'sealing' }));
      if (!stillOffered.isOk) {
        return stillOffered;
      }
      if ((await tx.sealings.findForUpdate(fleetId)) !== undefined) {
        return refuse('FLEET_ALREADY_SEALED', `Fleet ${fleetId} is sealed already`);
      }
      const at = deps.clock.now();
      const state: SealingState = (await tx.sealings.storesPlainPayload(fleetId)) ? 'sealing' : 'sealed';
      await tx.sealings.turnOn(
        { fleetId, state, since: at, progress: { toSeal: state === 'sealing' ? toSeal : 0, sealed: 0 }, companyKey, recoveryKey, keyAvailability: { isAvailable: true, since: at } },
        { id: deps.ids('dataKey'), fleetId, wrappedByCompanyKey: made.value.wrapped, wrappedByRecoveryKey, checkValue, createdAt: at, isCurrent: true },
      );
      await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'FleetSealingTurnedOn', occurredAt: at, actor: actorOf(caller), details: turnedOn });
      return ok({ state, ...turnedOn });
    });
  };
}
