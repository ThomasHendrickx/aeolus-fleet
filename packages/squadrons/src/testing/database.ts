import { createCopyOf } from '@aeolus-fleet/core/testing';

import { SQUADRONS_TEMPLATE } from './squadrons-global-setup.js';

/** A database of its own in the shared Postgres container, with squadrons' migrations applied. */
export function createSquadronsDatabase(): Promise<string> {
  return createCopyOf(SQUADRONS_TEMPLATE);
}
