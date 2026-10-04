import type { FleetId } from '@aeolus-fleet/common';

/** Every sign-in ticket starts so: it says what it is, as a ship secret and a crew token do. */
export const SIGN_IN_TICKET_PREFIX = 'aeolus_st_v1_';

/** How long a sign-in ticket stays valid after it is issued. */
export const SIGN_IN_TICKET_VALID_MS = 2 * 60 * 1000;

/** Whom a ticket signs in as: the operator, crewing argo, or a viewer, through the viewer ship (decision 0022). */
export type SignInAs = 'operator' | 'viewer';

/**
 * A one-time sign-in ticket for a fleet's operator or for a viewer, issued by
 * a hosting installation (docs/blueprint.md, "Installation") and redeemed in
 * the console for a session. Only its hash is stored; it signs in once,
 * before it expires.
 */
export interface SignInTicket {
  fleetId: FleetId;
  as: SignInAs;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}
