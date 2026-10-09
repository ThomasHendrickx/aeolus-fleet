/** A squadron's states and a member's healths (docs/squadrons.md), shared by the server's parsing and the browser's filters. */

export const SQUADRON_STATES = ['forming', 'sailing', 'standing-down', 'disbanded'] as const;
export type SquadronState = (typeof SQUADRON_STATES)[number];

/** A member's health: not on station until it is, then on time, late or silent by its last report. */
export const MEMBER_HEALTHS = ['not-on-station', 'on-time', 'late', 'silent', 'standing-down'] as const;
export type MemberHealth = (typeof MEMBER_HEALTHS)[number];
