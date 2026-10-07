/**
 * Labels (decision 0031): an owned vocabulary for selecting ships. A label is
 * a key with a defined set of values; a ship carries at most one value per
 * key. The limits below are the decision's; every refusal names it.
 */

/** The most characters a label's key or one of its values may have. */
export const LABEL_HANDLE_MAX_LENGTH = 63;

/** A label's key or value: lowercase letters, digits and hyphens, at least one. */
export const LABEL_HANDLE_PATTERN = /^[a-z0-9-]+$/;

/** The most values one label may define. */
export const LABEL_VALUES_MAX = 50;

/** The most labels one ship may carry. */
export const SHIP_LABELS_MAX = 20;
