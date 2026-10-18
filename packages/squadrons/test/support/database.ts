import { createCopyOf } from '@aeolus-fleet/core/testing';

/** The database squadrons' global setup migrates once; every squadrons database a test asks for is a copy of it. */
export const SQUADRONS_TEMPLATE = 'aeolus_test_squadrons_template';

/** A database of its own in the shared Postgres container, with squadrons' migrations applied. */
export function createSquadronsDatabase(): Promise<string> {
  return createCopyOf(SQUADRONS_TEMPLATE);
}
