import type { Theme } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { OperatorAccountRepository } from './ports.js';

export interface SetThemeTx {
  operatorAccounts: Pick<OperatorAccountRepository, 'findForFleetForUpdate' | 'setTheme'>;
}

export type SetTheme = (caller: Caller, input: { theme: Theme }) => Promise<Result<undefined, DomainError<'NOT_THE_OPERATOR_SHIP'>>>;

/**
 * Use case: the operator chooses how the console looks (Light, Dark or
 * System), stored on their account so it follows them to any browser. No
 * event: a theme is how the console looks, not a change to the fleet. Only the
 * operator's console session chooses it; a viewer's keeps its theme in the browser.
 */
export function createSetTheme(deps: { uow: UnitOfWork<SetThemeTx> }): SetTheme {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, DomainError<'NOT_THE_OPERATOR_SHIP'>>> => {
      const account = caller.consoleSessionId && caller.kind === 'operator' && (await tx.operatorAccounts.findForFleetForUpdate(caller.fleetId));
      if (!account) {
        return refuse('NOT_THE_OPERATOR_SHIP', 'Only the operator, signed in to the console, chooses a theme');
      }
      await tx.operatorAccounts.setTheme({ fleetId: caller.fleetId, operatorId: account.id, theme: input.theme });
      return ok(undefined);
    });
}
