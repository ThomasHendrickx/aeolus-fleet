/**
 * The messages a ship forms a squadron with (decision 0017): reserved by
 * convention between squadrons and the ships that form, never by Aeolus.
 */
export const FORM = 'application/vnd.aeolus.squadron.form+json';
export const FORMED = 'application/vnd.aeolus.squadron.formed+json';
export const FORM_REFUSED = 'application/vnd.aeolus.squadron.form-refused+json';

/** The scope a ship holds to form a squadron by message and stand it down. */
export const FORM_SCOPE = 'squadrons:form';
