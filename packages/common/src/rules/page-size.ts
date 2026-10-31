/** A page's size when the caller asks none (decision 4 of the performance design). */
export const PAGE_SIZE_DEFAULT = 100;

/** The most one page may hold. */
export const PAGE_SIZE_MAX = 500;

/**
 * A page of a ship's record when the caller asks none: what one screen shows
 * (Bridge, CC12). Each entry carries its whole payload, of up to 256 KB.
 */
export const RECORD_PAGE_SIZE_DEFAULT = 20;

/** The most one page of a ship's record may hold: whole payloads keep a page small. */
export const RECORD_PAGE_SIZE_MAX = 100;
