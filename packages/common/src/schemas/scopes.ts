import { z } from 'zod';

import { scopeNameSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';

/** One scope and its one-line description, as a namespace lists it. */
export const declaredScopeSchema = z.object({ scope: scopeNameSchema, description: z.string() });

/**
 * Input of `fleet.declareScopes` (scopes:declare): the caller's plugin
 * namespace and its whole list of scopes (decision 0046). Core checks each
 * rule and names its refusal.
 */
export const declareScopesInputSchema = z.object({
  namespace: z.string(),
  scopes: z.array(z.object({ scope: z.string(), description: z.string() })),
});

/** Output of `fleet.declareScopes`: the namespace as declared. */
export const declareScopesOutputSchema = z.object({ namespace: z.string(), scopes: z.array(declaredScopeSchema) });

/**
 * Output of `fleet.scopes` (fleet:read): every namespace of the fleet, the
 * core ones first, declared by no ship, then each plugin's by namespace,
 * with its declarer by id and name (decision 0046).
 */
export const scopesOutputSchema = z.array(
  z.object({
    namespace: z.string(),
    declaredBy: z.object({ id: idSchema('ship'), name: z.string() }).nullable(),
    scopes: z.array(declaredScopeSchema),
  }),
);
