import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { OperatorAccountRepository, SignInTicketRepository } from './ports.js';
import { SIGN_IN_TICKET_PREFIX, SIGN_IN_TICKET_VALID_MS } from './sign-in-ticket.js';

export interface IssueSignInTicketTx {
  operatorAccounts: OperatorAccountRepository;
  signInTickets: SignInTicketRepository;
  events: EventLog;
}

export type IssueSignInTicket = (input: { fleetId: FleetId }) => Promise<Result<{ ticket: string }, DomainError<'FLEET_NOT_FOUND'>>>;

/**
 * Use case: the installation issues a one-time sign-in ticket for a fleet's
 * operator (docs/blueprint.md, "Installation"): the hosting service hands it
 * to the operator's browser, and the console redeems it for a session. Only
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
  return ({ fleetId }) =>
    deps.uow.run(async (tx): Promise<Result<{ ticket: string }, DomainError<'FLEET_NOT_FOUND'>>> => {
      if (!(await tx.operatorAccounts.findForFleet(fleetId))) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      const at = deps.clock.now();
      const ticket = SIGN_IN_TICKET_PREFIX + deps.random.next();
      await tx.signInTickets.create({
        fleetId,
        tokenHash: deps.hasher.hash(ticket),
        issuedAt: at,
        expiresAt: new Date(at.getTime() + SIGN_IN_TICKET_VALID_MS),
        usedAt: null,
      });
      await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'SignInTicketIssued', occurredAt: at, actor: SYSTEM, details: {} });
      return ok({ ticket });
    });
}
