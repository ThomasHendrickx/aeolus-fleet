// The shared Postgres container's URL, which the global setup provides to every file.
import type {} from '../../../core/test/postgres.global-setup.js';
import { createCopyOf } from '../../../core/test/support/database.js';

/** The database squadrons' global setup migrates once; every squadrons database a test asks for is a copy of it. */
export const SQUADRONS_TEMPLATE = 'aeolus_test_squadrons_template';

/** A database of its own in the shared Postgres container, with squadrons' migrations applied. */
export function createSquadronsDatabase(): Promise<string> {
  return createCopyOf(SQUADRONS_TEMPLATE);
}
