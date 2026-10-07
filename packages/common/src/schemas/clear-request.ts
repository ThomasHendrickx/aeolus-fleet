import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { trierarchNameSchema } from '../trierarch/names.js';

/**
 * Inputs and outputs of the clear request procedures (decision 0032): a
 * declared request that a trierarch clear a worktree it kept. The worktree is
 * named by the ship it belonged to and its repository, never a path: the
 * trierarch maps the name to its path on its machine.
 */

/** The most pending clear requests one trierarch may hold (decision 0032). */
export const CLEAR_REQUESTS_PER_TRIERARCH_MAX = 100;

/** Input of `fleet.clearWorktree` (fleet:manage): the trierarch, and the kept worktree by its ship and repository. */
export const clearWorktreeInputSchema = z.object({
  trierarchShipId: idSchema('ship'),
  shipId: idSchema('ship'),
  repository: trierarchNameSchema,
});

/** Output of `fleet.clearWorktree`: nothing; the OK is the answer. */
export const clearWorktreeOutputSchema = z.strictObject({});

/** How a trierarch's clearing came out: it removed the worktree, or it kept no such worktree. */
export const CLEAR_OUTCOMES = ['removed', 'not-kept'] as const;
export const clearOutcomeSchema = z.enum(CLEAR_OUTCOMES);
export type ClearOutcome = z.infer<typeof clearOutcomeSchema>;

/** Input of `fleet.confirmWorktreeCleared` (crew:run): the worktree of a request to the caller's ship, and how it came out. */
export const confirmWorktreeClearedInputSchema = z.object({
  shipId: idSchema('ship'),
  repository: trierarchNameSchema,
  outcome: clearOutcomeSchema,
});

/** Output of `fleet.confirmWorktreeCleared`: nothing; the OK is the answer. */
export const confirmWorktreeClearedOutputSchema = z.strictObject({});

/**
 * Output of `fleet.clearRequests`: the pending clear requests (ISO 8601 in
 * UTC), every trierarch's to fleet:read, the caller's own to crew:run.
 */
export const clearRequestsOutputSchema = z.array(
  z.object({
    trierarchShipId: idSchema('ship'),
    shipId: idSchema('ship'),
    repository: trierarchNameSchema,
    requestedBy: idSchema('ship'),
    requestedAt: z.iso.datetime(),
  }),
);
