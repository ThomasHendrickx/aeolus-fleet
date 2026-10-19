import { z } from 'zod';

import { scopeNameSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';

/** The longest account id core accepts: pagasae's opaque id, never an email (decision 0058). */
export const ACCOUNT_ID_MAX_LENGTH = 128;

/** An account's id as pagasae names it: opaque to core, which stores no account (decision 0058). */
export const accountIdSchema = z.string().min(1).max(ACCOUNT_ID_MAX_LENGTH).brand<'AccountId'>();
export type AccountId = z.infer<typeof accountIdSchema>;

const MILLISECONDS_PER_SECOND = 1000;

/**
 * The claims of an account token pagasae signed for one account in one fleet
 * (decision 0058), read once its signature and issuer are checked: the
 * account, its organisation, the fleet (its audience), the scopes and `group`
 * values its groups and own rights give there, its person ship there if it
 * has one, and when it was issued and ends. Times are JWT seconds.
 */
export const accountTokenClaimsSchema = z
  .object({
    iss: z.string(),
    aud: idSchema('fleet'),
    sub: accountIdSchema,
    org: z.string().min(1),
    scope: z.string(),
    group: z.array(z.string()),
    person_ship: idSchema('ship').optional(),
    iat: z.number(),
    exp: z.number(),
  })
  .transform((claims, context) => {
    const scopes = claims.scope.split(' ').filter((scope) => scope !== '');
    const parsed = z.array(scopeNameSchema).safeParse(scopes);
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: 'scope holds a malformed or unknown scope', path: ['scope'] });
      return z.NEVER;
    }
    return {
      issuer: claims.iss,
      fleetId: claims.aud,
      accountId: claims.sub,
      organisationId: claims.org,
      scopes: parsed.data,
      groupValues: claims.group,
      personShipId: claims.person_ship ?? null,
      issuedAt: new Date(claims.iat * MILLISECONDS_PER_SECOND),
      endsAt: new Date(claims.exp * MILLISECONDS_PER_SECOND),
    };
  });
export type AccountTokenClaims = z.infer<typeof accountTokenClaimsSchema>;

/** The request header whoever acts for a human presents the account's token in, beside its own crew token if it has one (decision 0058). */
export const ACCOUNT_TOKEN_HEADER = 'aeolus-account-token';

/** The request header the installation names the fleet it acts in with, beside its installation token (decision 0057). */
export const FLEET_HEADER = 'aeolus-fleet';
