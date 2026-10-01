import type { Theme } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ConsoleSessionRepository, OperatorAccountRepository } from './ports.js';

export interface ReadAccountTx {
  operatorAccounts: Pick<OperatorAccountRepository, 'findForFleet'>;
  consoleSessions: Pick<ConsoleSessionRepository, 'find'>;
}

export interface AccountView {
  email: string;
  theme: Theme;
  /** This console session: the device it signed in from, and since when. */
  session: { device: string; since: Date };
}

export type ReadAccount = (caller: Caller) => Promise<Result<AccountView, DomainError<'NOT_THE_OPERATOR_SHIP'>>>;

/**
 * Use case: the signed-in operator's account, for the AccountMenu: their
 * email, their theme, and this console session. Only a console session has
 * one; any other caller is refused.
 */
export function createReadAccount(deps: { uow: UnitOfWork<ReadAccountTx> }): ReadAccount {
  return (caller) =>
    deps.uow.run(async (tx): Promise<Result<AccountView, DomainError<'NOT_THE_OPERATOR_SHIP'>>> => {
      const { consoleSessionId } = caller;
      const session = consoleSessionId && (await tx.consoleSessions.find(caller.fleetId, consoleSessionId));
      const account = session && (await tx.operatorAccounts.findForFleet(caller.fleetId));
      if (!session || !account) {
        return refuse('NOT_THE_OPERATOR_SHIP', 'Only the operator, signed in to the console, has an account');
      }
      return ok({
        email: account.email,
        theme: account.theme,
        session: { device: session.device, since: session.createdAt },
      });
    });
}
