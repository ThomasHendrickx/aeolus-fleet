/** The public bounded commission grant: core treats its subject digest as opaque. */
import { z } from 'zod';

import { scopeNameSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { accountIdSchema } from './account-token.js';

export const commissionApprovalUseSchema = z.object({ approvalId: idSchema('commissionApproval'), subjectDigest: z.string().min(1) });
export const approveCommissionInputSchema = z.object({ commissionerId: idSchema('ship'), scopes: z.array(scopeNameSchema), subjectDigest: z.string().min(1) });
export const approveCommissionOutputSchema = z.object({ approvalId: idSchema('commissionApproval') });
export const withdrawCommissionApprovalInputSchema = z.object({ approvalId: idSchema('commissionApproval') });
export const withdrawCommissionApprovalOutputSchema = z.strictObject({});

/** The actor is kept independently of its future scopes, token or lease. */
export const commissionApproverSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ship'), shipId: idSchema('ship'), signedInAccountId: accountIdSchema.optional() }),
  z.object({ kind: z.literal('account'), accountId: accountIdSchema, throughShipId: idSchema('ship').nullable() }),
  z.object({ kind: z.literal('installation') }),
  z.object({ kind: z.literal('system') }),
]);

/** A stored approval, parsed when it crosses the database boundary. */
export const commissionApprovalRecordSchema = z.object({
  id: idSchema('commissionApproval'),
  fleetId: idSchema('fleet'),
  approver: commissionApproverSchema,
  commissionerId: idSchema('ship'),
  scopes: z.array(scopeNameSchema),
  subjectDigest: z.string().min(1),
  createdAt: z.date(),
  withdrawnAt: z.date().nullable(),
});
