import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import { findViewerShip, type ShipTx } from '../registry/public.js';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { OperatorAccountRepository, SignInTicketRepository } from './ports.js';
import { SIGN_IN_TICKET_PREFIX, SIGN_IN_TICKET_VALID_MS, type SignInAs } from './sign-in-ticket.js';

export interface IssueSignInTicketTx extends ShipTx {
  operatorAccounts: OperatorAccountRepository;
  signInTickets: SignInTicketRepository;
  events: EventLog;
}

export type IssueSignInTicketRefusal = DomainError<'FLEET_NOT_FOUND' | 'FLEET_HAS_NO_VIEWER'>;

export type IssueSignInTicket = (input: {
  fleetId: FleetId;
  /** Whom it signs in as: the operator when left out, or a viewer of a fleet with a viewer ship (decision 0022). */
  as?: SignInAs;
}) => Promise<Result<{ ticket: string }, IssueSignInTicketRefusal>>;

/**
 * Use case: the installation issues a one-time sign-in ticket for a fleet's
 * operator, or for a viewer of a fleet with a viewer ship (docs/blueprint.md,
 * "Installation"; decision 0022): the hosting service hands it to the
 * person's browser, and the console redeems it for a session. Only
 * its hash is stored; it is valid 2 minutes and signs in once. Each ticket
 * stands alone: a new one leaves an earlier unused one to expire.
 */
export function createIssueSignInTicket(deps: {
  uow: UnitOfWork<IssueSignInTicketTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: SecretHasher;
  random: RandomTokens;
}): IssueSignInTicket {
  return ({ fleetId, as = 'operator' }) =>
    deps.uow.run(async (tx): Promise<Result<{ ticket: string }, IssueSignInTicketRefusal>> => {
      if (!(await tx.operatorAccounts.findForFleet(fleetId))) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      if (as === 'viewer') {
        const viewer = await findViewerShip(tx, fleetId);
        if (!viewer.isOk) {
          return viewer;
        }
      }
      const at = deps.clock.now();
      const ticket = SIGN_IN_TICKET_PREFIX + deps.random.next();
      await tx.signInTickets.create({
        fleetId,
        as,
        tokenHash: deps.hasher.hash(ticket),
        issuedAt: at,
        expiresAt: new Date(at.getTime() + SIGN_IN_TICKET_VALID_MS),
        usedAt: null,
      });
      await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'SignInTicketIssued', occurredAt: at, actor: SYSTEM, details: { as } });
      return ok({ ticket });
    });
}
