import type { IdGenerator } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { UNKNOWN_DEVICE } from './console-session.js';
import type { SignInTicketRepository } from './ports.js';
import type { SignedIn } from './sign-in.js';
import { startConsoleSession, type StartConsoleSessionTx } from './start-console-session.js';

export interface RedeemSignInTicketTx extends StartConsoleSessionTx {
  signInTickets: SignInTicketRepository;
}

export type RedeemSignInTicketRefusal = DomainError<'SIGN_IN_TICKET_INVALID' | 'FLEET_NOT_FOUND' | 'NOT_THE_OPERATOR_SHIP'>;

export type RedeemSignInTicket = (input: {
  ticket: string;
  /** The device it signs in from, as the console words it; an unknown device when not told. */
  device?: string;
}) => Promise<Result<SignedIn, RedeemSignInTicketRefusal>>;

/**
 * Use case: the console redeems a sign-in ticket the installation issued, and
 * the operator's session starts exactly as after a password sign-in: it takes
 * argo's lease over and ends any previous session. A ticket signs in once and
 * only before it expires; used, expired and unknown tickets are one refusal,
 * which says nothing about which it was.
 */
export function createRedeemSignInTicket(deps: {
  uow: UnitOfWork<RedeemSignInTicketTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: SecretHasher;
  random: RandomTokens;
}): RedeemSignInTicket {
  return (input) =>
    deps.uow.run(async (tx): Promise<Result<SignedIn, RedeemSignInTicketRefusal>> => {
      const at = deps.clock.now();
      const fleetId = await tx.signInTickets.redeem(deps.hasher.hash(input.ticket), at);
      if (fleetId === undefined) {
        return refuse('SIGN_IN_TICKET_INVALID', 'This sign-in link is used or expired: sign in again');
      }
      return startConsoleSession({ tx, ids: deps.ids, hasher: deps.hasher, random: deps.random }, { fleetId, device: input.device ?? UNKNOWN_DEVICE, at });
    });
}
