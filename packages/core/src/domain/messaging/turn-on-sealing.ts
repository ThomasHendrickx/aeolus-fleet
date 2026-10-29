import type { IdGenerator } from '@aeolus-fleet/common';

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
import type { FleetSealingRepository } from './ports.js';

export interface TurnOnSealingTx {
  sealings: FleetSealingRepository;
  events: EventLog;
}

export interface SealingTurnedOn {
  state: SealingState;
  companyKey: CompanyKeyReference;
}

export type TurnOnSealingRefusal = DomainError<'FORBIDDEN' | 'FLEET_ALREADY_SEALED' | 'KEY_UNAVAILABLE' | 'KEY_NOT_BOUND_TO_FLEET'>;

export type TurnOnSealing = (caller: Caller, input: { companyKey: CompanyKeyReference }) => Promise<Result<SealingTurnedOn, TurnOnSealingRefusal>>;

/**
 * Use case: turning sealing on for the caller's fleet (decision 0068, B4),
 * by an actor holding `fleet:keys`, as the fleet manager does. Checked in
 * order: the caller's scope; that the fleet is not sealed; that the
 * company's key vault makes a data key under the company key for this
 * fleet's context and unwraps it again; and that it refuses one for another
 * fleet's context, so a key whose policy has no fleet condition, which one
 * tenant could point at another's key with, is refused
 * KEY_NOT_BOUND_TO_FLEET. Every key vault call runs before the unit of work;
 * a refusal or no answer is KEY_UNAVAILABLE with its reason, and nothing is
 * stored. Then one unit of work: the fleet sealed under its company key,
 * its first data key current, FleetSealingTurnedOn naming the key reference
 * and no key material. A fleet that stores a plain payload reads sealing
 * until the sealing pass leaves none; one that stores none reads sealed.
 */
export function createTurnOnSealing(deps: {
  uow: UnitOfWork<TurnOnSealingTx>;
  clock: Clock;
  ids: IdGenerator;
  vault: KeyVault;
  sealer: PayloadSealer;
  /** The fleets' sealing, read outside the unit of work. */
  sealings: FleetSealingRepository;
}): TurnOnSealing {
  return async (caller, { companyKey }) => {
    if (!hasScope(caller, 'fleet:keys')) {
      return refuse('FORBIDDEN', 'Turning sealing on needs the fleet:keys scope');
    }
    const { fleetId } = caller;
    if ((await deps.sealings.find(fleetId)) !== undefined) {
      return refuse('FLEET_ALREADY_SEALED', `Fleet ${fleetId} is sealed already`);
    }
    const made = await checkCompanyKey(deps, { fleetId, companyKey });
    if (!made.isOk) {
      return made;
    }
    const checkValue = deps.sealer.checkValue(made.value.unwrapped);

    return deps.uow.run(async (tx): Promise<Result<SealingTurnedOn, TurnOnSealingRefusal>> => {
      if ((await tx.sealings.findForUpdate(fleetId)) !== undefined) {
        return refuse('FLEET_ALREADY_SEALED', `Fleet ${fleetId} is sealed already`);
      }
      const at = deps.clock.now();
      const state: SealingState = (await tx.sealings.storesPlainPayload(fleetId)) ? 'sealing' : 'sealed';
      await tx.sealings.turnOn(
        { fleetId, state, companyKey, keyAvailability: { isAvailable: true, since: at } },
        { id: deps.ids('dataKey'), fleetId, wrappedByCompanyKey: made.value.wrapped, checkValue, createdAt: at, isCurrent: true },
      );
      await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'FleetSealingTurnedOn', occurredAt: at, actor: actorOf(caller), details: { companyKey } });
      return ok({ state, companyKey });
    });
  };
}
