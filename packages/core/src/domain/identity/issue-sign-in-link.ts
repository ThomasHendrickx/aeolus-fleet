import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { OperatorAccountRepository, SignInTicketRepository } from './ports.js';
import { SIGN_IN_LINK_VALID_MS, SIGN_IN_TICKET_PREFIX } from './sign-in-ticket.js';

export interface IssueSignInLinkTx {
  operatorAccounts: OperatorAccountRepository;
  signInTickets: SignInTicketRepository;
  events: EventLog;
}

export type IssueSignInLink = (input: { fleetId: FleetId }) => Promise<Result<{ ticket: string; expiresAt: Date }, DomainError<'FLEET_NOT_FOUND'>>>;

/**
 * Use case: a server command issues a one-use sign-in ticket for argo's own
 * sign-in, which the terminal prints as a console link (accounts design, A1):
 * how a self-hosted fleet's first human gets in, with no email or password,
 * and again from another browser. It names no account. Only its hash is
 * stored; it is valid 15 minutes, long enough to copy into a browser, and
 * the console redeems it as any operator ticket. A server command: the
 * system is the actor.
 */
export function createIssueSignInLink(deps: {
  uow: UnitOfWork<IssueSignInLinkTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: SecretHasher;
  random: RandomTokens;
}): IssueSignInLink {
  return ({ fleetId }) =>
    deps.uow.run(async (tx): ReturnType<IssueSignInLink> => {
      if (!(await tx.operatorAccounts.findForFleet(fleetId))) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      const at = deps.clock.now();
      const ticket = SIGN_IN_TICKET_PREFIX + deps.random.next();
      const expiresAt = new Date(at.getTime() + SIGN_IN_LINK_VALID_MS);
      await tx.signInTickets.create({ fleetId, as: 'operator', accountId: null, tokenHash: deps.hasher.hash(ticket), issuedAt: at, expiresAt, usedAt: null });
      await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'SignInTicketIssued', occurredAt: at, actor: SYSTEM, details: { as: 'operator' } });
      return ok({ ticket, expiresAt });
    });
}
