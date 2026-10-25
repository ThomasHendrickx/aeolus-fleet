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
 * Output of `fleet.scopes` (fleet:read): every namespace of the fleet,
 * saying whose it is: the core ones first, declared by no ship, then the
 * plugins' and the fleet's own by namespace, a plugin's with its declarer by
 * id and name (decision 0046).
 */
export const scopesOutputSchema = z.array(
  z.object({
    namespace: z.string(),
    kind: z.enum(['core', 'plugin', 'fleet']),
    declaredBy: z.object({ id: idSchema('ship'), name: z.string() }).nullable(),
    scopes: z.array(declaredScopeSchema),
  }),
);

/**
 * Input of `fleet.grantScopes` (scopes:grant): the live ship, and the scopes
 * granted and revoked at once, each within what the caller's ship may grant
 * (decision 0046).
 */
export const grantScopesInputSchema = z.object({ shipId: idSchema('ship'), grant: z.array(z.string()), revoke: z.array(z.string()) });

/** Output of `fleet.grantScopes`: every scope the ship holds now. */
export const grantScopesOutputSchema = z.object({ scopes: z.array(scopeNameSchema) });

/**
 * Input of `fleet.defineScope` and `fleet.describeScope` (scopes:define):
 * one of the fleet's own scopes and its one-line description (design
 * gateway-scopes, 4.1). Core checks each rule and names its refusal.
 */
export const defineScopeInputSchema = z.object({ scope: z.string(), description: z.string() });

/** Output of `fleet.defineScope` and `fleet.describeScope`: the scope as the fleet has it now. */
export const definedScopeOutputSchema = declaredScopeSchema;

/** Input of `fleet.removeScope` (scopes:define): one of the fleet's own scopes. */
export const removeScopeInputSchema = z.object({ scope: z.string() });

/** Output of `fleet.removeScope`: nothing, once the scope is gone. */
export const removeScopeOutputSchema = z.object({});
