import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/**
 * A verified fact (decision 0059): what an actor checked about a ship, stored
 * as its writer wrote it and shown beside the ship's statement in discovery,
 * naming the writer. One fixed shape: what was checked, from a closed list,
 * the value the check found, and the issuer only where a value means
 * something under one. Core checks the shape and acts on none of it.
 */

/**
 * What a writer may have checked: the domain a client id document came from,
 * the host a TLS certificate was valid for, the domain an A2A card came from,
 * and the subject an OAuth issuer issued a credential to.
 */
export const VERIFIED_CHECKS = ['clientIdDocumentDomain', 'tlsHost', 'a2aCardDomain', 'oauthSubject'] as const;
export const verifiedCheckSchema = z.enum(VERIFIED_CHECKS);
export type VerifiedCheck = z.infer<typeof verifiedCheckSchema>;

/** The longest value a fact holds: a domain, a host or a subject. */
export const VERIFIED_FACT_VALUE_MAX_LENGTH = 255;

/** The longest issuer a fact names. */
export const VERIFIED_FACT_ISSUER_MAX_LENGTH = 2048;

/** The most facts one writer holds about one ship. */
export const VERIFIED_FACTS_MAX = 10;

const valueSchema = z.string().min(1).max(VERIFIED_FACT_VALUE_MAX_LENGTH);

/** One fact as its writer writes it: an OAuth subject with its issuer, every other check without one. */
export const verifiedFactSchema = z.discriminatedUnion('checked', [
  z.strictObject({ checked: z.enum(['clientIdDocumentDomain', 'tlsHost', 'a2aCardDomain']), value: valueSchema }),
  z.strictObject({ checked: z.literal('oauthSubject'), issuer: z.string().min(1).max(VERIFIED_FACT_ISSUER_MAX_LENGTH), value: valueSchema }),
]);
export type VerifiedFact = z.infer<typeof verifiedFactSchema>;

/** The same fact twice is the same check, issuer and value. */
function factKey(fact: VerifiedFact): string {
  return JSON.stringify([fact.checked, 'issuer' in fact ? fact.issuer : null, fact.value]);
}

/**
 * Input of `fleet.setVerifiedFacts` (fleet:verify): the ship written about
 * and the caller's facts about it, whole, each fact once; none withdraws
 * them.
 */
export const setVerifiedFactsInputSchema = z.object({
  shipId: idSchema('ship'),
  facts: z
    .array(verifiedFactSchema)
    .max(VERIFIED_FACTS_MAX, `A writer holds at most ${String(VERIFIED_FACTS_MAX)} facts about a ship`)
    .refine((facts) => new Set(facts.map(factKey)).size === facts.length, 'Each fact once'),
});

/** Output of `fleet.setVerifiedFacts`: nothing; the OK is the answer. */
export const setVerifiedFactsOutputSchema = z.strictObject({});
