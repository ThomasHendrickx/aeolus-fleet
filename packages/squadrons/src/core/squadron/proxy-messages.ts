/**
 * The messages a flagship proxies with between its squadron and its forming
 * ship (decision 0017): reserved by convention between squadrons and the
 * ships it serves, never by Aeolus.
 */
export const RELAY = 'application/vnd.aeolus.squadron.relay+json';
export const REFUSED = 'application/vnd.aeolus.squadron.refused+json';
export const STANDING_DOWN = 'application/vnd.aeolus.squadron.standing-down+json';
export const ADD_MEMBER = 'application/vnd.aeolus.squadron.add-member+json';
export const MEMBER_ADDED = 'application/vnd.aeolus.squadron.member-added+json';
export const REMOVE_MEMBER = 'application/vnd.aeolus.squadron.remove-member+json';
export const MEMBER_REMOVED = 'application/vnd.aeolus.squadron.member-removed+json';

/** The scope that adds and removes members of the squadrons a ship formed. */
export const SCALE_SCOPE = 'squadrons:scale';

/** The operator's ship: its name is reserved (decision 0012), so a sender by this name is argo. */
export const ARGO_NAME = 'argo';
