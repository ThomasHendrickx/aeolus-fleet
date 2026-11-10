/** A bounded grant for commission, independent of the owner of the resulting ship (0045/0046). */
import type { CommissionApprovalId, FleetId, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { actorOf, isShipCaller, type Caller } from '../shared/caller.js';
import type { NamedNamespaces } from './named-namespaces.js';
import { mayGrant, type Granter, type GrantScopesRefusal } from './scope-grant.js';

export interface CommissionApproval {
  readonly id: CommissionApprovalId;
  readonly fleetId: FleetId;
  readonly approver: Actor;
  readonly commissionerId: ShipId;
  readonly scopes: readonly string[];
  readonly subjectDigest: string;
  readonly createdAt: Date;
  readonly withdrawnAt: Date | null;
}

/** Approval and commission hold the same row until their transaction ends. */
export interface CommissionApprovalRepository {
  create(approval: CommissionApproval): Promise<void>;
  findForUpdate(fleetId: FleetId, id: CommissionApprovalId): Promise<CommissionApproval | undefined>;
  withdraw(input: { fleetId: FleetId; id: CommissionApprovalId; at: Date }): Promise<void>;
}

/** The owner source is separate; only the permitted commissioner uses this bounded grant. */
export interface CommissionApprovalUse {
  approvalId: CommissionApprovalId;
  subjectDigest: string;
}

/** Checks a kept grant, never the approver's later authority. */
export function checkCommissionApproval(
  approval: CommissionApproval,
  use: { commissionerId: ShipId | null; subjectDigest: string; scopes: readonly string[] },
): Result<null, CommissionApprovalRefusal> {
  if (approval.withdrawnAt !== null) {
    return refuse('COMMISSION_APPROVAL_WITHDRAWN', 'This commission approval was withdrawn');
  }
  if (approval.commissionerId !== use.commissionerId || approval.subjectDigest !== use.subjectDigest) {
    return refuse('COMMISSION_APPROVAL_MISMATCH', 'The commission approval names another commissioner or subject digest');
  }
  const outside = use.scopes.find((scope) => !approval.scopes.includes(scope));
  return outside === undefined ? ok(null) : refuse('SCOPE_NOT_HELD', `${outside} is outside this commission approval`);
}

export type CommissionApprovalRefusal = DomainError<'COMMISSION_APPROVAL_WITHDRAWN' | 'COMMISSION_APPROVAL_MISMATCH' | 'SCOPE_NOT_HELD'>;

/** A new immutable approval and its event, from the rights the approver may grant now. */
export function approveCommission(
  input: { approval: CommissionApproval; granter: Granter },
  named: NamedNamespaces,
): Result<{ approval: CommissionApproval; events: NewEvent[] }, GrantScopesRefusal> {
  const { approval, granter } = input;
  for (const scope of approval.scopes) {
    const granted = mayGrant(scope, { granter, ...named });
    if (!granted.isOk) {
      return granted;
    }
  }
  return ok({ approval, events: [{ fleetId: approval.fleetId, actor: approval.approver, occurredAt: approval.createdAt, type: 'CommissionApproved', shipId: approval.commissionerId, details: { approvalId: approval.id, scopes: approval.scopes.join(' '), subjectDigest: approval.subjectDigest } }] });
}

/** The original actor's identity, independent of a presenting ship or an argo sign-in. */
export function isCommissionApprover(caller: Caller, approver: Actor): boolean {
  if (isShipCaller(caller)) {
    return approver.kind === 'ship' && caller.shipId === approver.shipId;
  }
  return caller.kind === 'account' ? approver.kind === 'account' && caller.accountId === approver.accountId : approver.kind === 'installation';
}

/** Withdrawal changes no grant facts and never alters an existing ship. */
export function withdrawCommissionApproval(
  input: { approval: CommissionApproval; caller: Caller; at: Date },
  named: NamedNamespaces,
): Result<{ approval: CommissionApproval; events: NewEvent[] }, GrantScopesRefusal> {
  const { approval, caller, at } = input;
  if (!isCommissionApprover(caller, approval.approver)) {
    const granter = { shipId: isShipCaller(caller) ? caller.shipId : null, isOperator: caller.kind === 'operator', scopes: caller.scopes };
    for (const scope of approval.scopes) {
      const granted = mayGrant(scope, { granter, ...named });
      if (!granted.isOk) {
        return granted;
      }
    }
  }
  return ok(approval.withdrawnAt === null
    ? { approval: { ...approval, withdrawnAt: at }, events: [{ fleetId: approval.fleetId, actor: actorOf(caller), occurredAt: at, type: 'CommissionApprovalWithdrawn', shipId: approval.commissionerId, details: { approvalId: approval.id } }] }
    : { approval, events: [] });
}
