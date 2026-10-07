import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { revokeShipSecret, type SecretTools } from '../identity/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkReaches } from './crew-request.js';
import type { CrewRequestRepository, LeaseRepository, ShipRepository } from './ports.js';
import { checkCanIssueStartingPrompt } from './ship.js';
import { issueStartingPrompt, type IssuedStartingPrompt, type StartingPromptTx } from './starting-prompt.js';

export interface GetStartingPromptTx extends StartingPromptTx {
  ships: ShipRepository;
  leases: LeaseRepository;
  crewRequests: Pick<CrewRequestRepository, 'find'>;
}

export type GetStartingPromptRefusal = DomainError<
  'SHIP_NOT_FOUND' | 'OPERATOR_SHIP_GETS_NO_STARTING_PROMPT' | 'SHIP_NOT_AWAITING_CREW' | 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER'
>;

export type GetStartingPrompt = (
  caller: Caller,
  input: { shipId: ShipId },
) => Promise<Result<IssuedStartingPrompt, GetStartingPromptRefusal>>;

/**
 * Use case: a new starting prompt for a ship of the caller's fleet that awaits
 * crew. Its new secret invalidates any earlier one, so at most one is valid; a
 * prompt lost before use costs nothing. The caller's scope (fleet:manage or
 * crew:run) is checked before this runs; crew:run reaches only
 * the ships whose crew requests are assigned to the caller's ship.
 *
 * Locks in the fleet's order: the ship first, so concurrent prompts for one
 * ship take turns and the last one issued is the valid one; then its secret;
 * then its lease. The lease is read last, so a session that claimed the ship
 * with the old secret meanwhile is seen, and the refusal rolls the revocation
 * back.
 */
/** The scopes that reach every ship for a starting prompt; crew:run reaches only assigned ones. */
const PROMPT_SCOPES = ['fleet:manage'] as const;

export function createGetStartingPrompt(deps: {
  uow: UnitOfWork<GetStartingPromptTx>;
  clock: Clock;
  ids: IdGenerator;
  secrets: Omit<SecretTools, 'ids'>;
}): GetStartingPrompt {
  return (caller, { shipId }) =>
    deps.uow.run(async (tx): Promise<Result<IssuedStartingPrompt, GetStartingPromptRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
      }
      const reaches = checkReaches(caller, { ship, current: await tx.crewRequests.find(fleetId, shipId), broadScopes: PROMPT_SCOPES });
      if (!reaches.isOk) {
        return reaches;
      }
      const actor = shipActor(caller.shipId);
      const at = deps.clock.now();
      await revokeShipSecret({ tx, ids: deps.ids }, { fleetId, shipId, actor, at });
      const lease = await tx.leases.findOpenForUpdate(fleetId, shipId);
      const allowed = checkCanIssueStartingPrompt(ship, { isCrewed: lease !== undefined });
      if (!allowed.isOk) {
        return allowed;
      }

      const issued = await issueStartingPrompt(
        { tx, secrets: { ...deps.secrets, ids: deps.ids } },
        { fleetId, shipId, actor, at },
      );
      return ok(issued);
    });
}
