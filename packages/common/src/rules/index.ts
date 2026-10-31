/**
 * `@aeolus-fleet/common/rules`: the plain rules the console's live hints use
 * in the browser (decision 0033), without zod, so a page that uses one carries
 * no schema. Common's schemas are built on the same rules, and the server
 * stays the authority on submit. It also holds what the header's app switcher
 * offers, worked out from pagasae's apps list, which each app hands to
 * `@aeolus-fleet/ui`'s AppSwitcher as props.
 */
export * from './activity.js';
export * from './alert.js';
export * from './app-switcher.js';
export * from './duration.js';
export * from './label-handle.js';
export * from './page-size.js';
export * from './payload.js';
export * from './plain-http.js';
export * from './read-reach.js';
export * from './ship-handle.js';
export * from './ship-filter.js';
export * from './sign-in.js';
