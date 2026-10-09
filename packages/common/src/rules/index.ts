/**
 * `@aeolus-fleet/common/rules`: the plain rules the console's live hints use
 * in the browser (decision 0033), without zod, so a page that uses one carries
 * no schema. Common's schemas are built on the same rules, and the server
 * stays the authority on submit.
 */
export * from './label-handle.js';
export * from './payload.js';
export * from './ship-handle.js';
export * from './sign-in.js';
