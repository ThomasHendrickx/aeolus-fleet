/** Withdrawal orders new commissions without changing ships already commissioned. */
import type { CommissionApprovalId, IdGenerator } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { keepingReachRefusal } from './check-reach.js';
import type { ApproveCommissionTx, ApproveCommissionRefusal } from './approve-commission.js';
import { commissionApprovalAuthority } from './commission-approval-authority.js';
import { lockNamedNamespaces } from './named-namespaces.js';
import { isCommissionApprover, withdrawCommissionApproval } from './commission-approval.js';

export type WithdrawCommissionApprovalRefusal = ApproveCommissionRefusal | DomainError<'COMMISSION_APPROVAL_NOT_FOUND'>;
export type WithdrawCommissionApproval = (caller: Caller, input: { approvalId: CommissionApprovalId }) => Promise<Result<Record<string, never>, WithdrawCommissionApprovalRefusal>>;

export function createWithdrawCommissionApproval(deps: { uow: UnitOfWork<ApproveCommissionTx>; clock: Clock; ids: IdGenerator }): WithdrawCommissionApproval {
  return (caller, input) => keepingReachRefusal(deps.uow, async (tx): Promise<Result<Record<string, never>, WithdrawCommissionApprovalRefusal>> => {
    const approval = await tx.commissionApprovals.findForUpdate(caller.fleetId, input.approvalId);
    if (!approval) {
      return refuse('COMMISSION_APPROVAL_NOT_FOUND', 'This fleet has no such commission approval');
    }
    const at = deps.clock.now();
    const isOwnWithdrawal = isCommissionApprover(caller, approval.approver);
    const authority = await commissionApprovalAuthority({ tx, ids: deps.ids }, { caller, commissionerId: approval.commissionerId, at, isOwnWithdrawal });
    if (!authority.isOk) {
      return authority;
    }
    const named = isOwnWithdrawal ? { namespaces: new Map(), defined: new Set<string>() } : await lockNamedNamespaces(tx, { fleetId: caller.fleetId, scopes: approval.scopes });
    const withdrawn = withdrawCommissionApproval({ approval, caller: authority.value, at }, named);
    if (!withdrawn.isOk) {
      return withdrawn;
    }
    if (withdrawn.value.events.length > 0) {
      await tx.commissionApprovals.withdraw({ fleetId: caller.fleetId, id: approval.id, at });
      for (const event of withdrawn.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
    }
    return ok({});
  });
}
