/** Records immutable commission rights granted by an actor, until explicit withdrawal. */
import type { CommissionApprovalId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { actorOf, isShipCaller, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { keepingReachRefusal } from './check-reach.js';
import { approveCommission, type CommissionApprovalRepository } from './commission-approval.js';
import { commissionApprovalAuthority, type ApprovalAuthorityRefusal, type ApprovalAuthorityTx } from './commission-approval-authority.js';
import { lockNamedNamespaces, type NamedNamespacesTx } from './named-namespaces.js';
import type { GrantScopesRefusal } from './scope-grant.js';

export interface ApproveCommissionTx extends ApprovalAuthorityTx, Omit<NamedNamespacesTx, 'ships'> {
  commissionApprovals: CommissionApprovalRepository;
  events: EventLog;
}

export interface ApproveCommissionInput {
  commissionerId: ShipId;
  scopes: readonly string[];
  subjectDigest: string;
}

export type ApproveCommissionRefusal = ApprovalAuthorityRefusal | GrantScopesRefusal;
export type ApproveCommission = (caller: Caller, input: ApproveCommissionInput) => Promise<Result<{ approvalId: CommissionApprovalId }, ApproveCommissionRefusal>>;

export function createApproveCommission(deps: { uow: UnitOfWork<ApproveCommissionTx>; clock: Clock; ids: IdGenerator }): ApproveCommission {
  return (caller, input) => keepingReachRefusal(deps.uow, async (tx): Promise<Result<{ approvalId: CommissionApprovalId }, ApproveCommissionRefusal>> => {
    const at = deps.clock.now();
    const authority = await commissionApprovalAuthority({ tx, ids: deps.ids }, { caller, commissionerId: input.commissionerId, at, isOwnWithdrawal: false });
    if (!authority.isOk) {
      return authority;
    }
    const approver = authority.value;
    const named = await lockNamedNamespaces(tx, { fleetId: caller.fleetId, scopes: input.scopes });
    const granter = { shipId: isShipCaller(approver) ? approver.shipId : null, isOperator: approver.kind === 'operator', scopes: approver.scopes };
    const approval = { ...input, scopes: [...new Set(input.scopes)].toSorted(), id: deps.ids('commissionApproval'), fleetId: caller.fleetId, approver: actorOf(caller), createdAt: at, withdrawnAt: null };
    const approved = approveCommission({ approval, granter }, named);
    if (!approved.isOk) {
      return approved;
    }
    await tx.commissionApprovals.create(approved.value.approval);
    for (const event of approved.value.events) {
      await recordEvent({ events: tx.events, ids: deps.ids }, event);
    }
    return ok({ approvalId: approval.id });
  });
}
