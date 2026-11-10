/** Records immutable commission rights granted by an actor, until explicit withdrawal. */
import type { CommissionApprovalId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { CommissionApprovalRepository } from './commission-approval.js';

export interface ApproveCommissionTx {
  commissionApprovals: CommissionApprovalRepository;
  events: EventLog;
}

export interface ApproveCommissionInput {
  commissionerId: ShipId;
  scopes: readonly string[];
  subjectDigest: string;
}

export type ApproveCommission = (caller: Caller, input: ApproveCommissionInput) => Promise<Result<{ approvalId: CommissionApprovalId }, never>>;

export function createApproveCommission(deps: { uow: UnitOfWork<ApproveCommissionTx>; clock: Clock; ids: IdGenerator }): ApproveCommission {
  return (caller, input) => deps.uow.run(async (tx) => {
    const approval = { ...input, scopes: [...new Set(input.scopes)].toSorted(), id: deps.ids('commissionApproval'), fleetId: caller.fleetId, approver: actorOf(caller), createdAt: deps.clock.now(), withdrawnAt: null };
    await tx.commissionApprovals.create(approval);
    await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId: caller.fleetId, actor: approval.approver, occurredAt: approval.createdAt, type: 'CommissionApproved', shipId: input.commissionerId, details: { approvalId: approval.id, scopes: approval.scopes.join(' '), subjectDigest: approval.subjectDigest } });
    return ok({ approvalId: approval.id });
  });
}
