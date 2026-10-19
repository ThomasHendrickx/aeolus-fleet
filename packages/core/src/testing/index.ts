/**
 * `@aeolus-fleet/core/testing`: what a package of another release train
 * (decision 0049) needs to test against a real core in its own process: the
 * shared Postgres container and its databases, the app and its use cases, and
 * the fixtures they take. Never imported by core's own source. A vitest
 * global setup takes `@aeolus-fleet/core/testing/postgres-global-setup`
 * instead: this entry imports vitest, which a global setup may not.
 */
// What the Postgres global setup provides to every test file, for `inject` and `getProvidedContext`.
import type {} from './postgres-global-setup.js';

export { argon2idPasswordHasher } from '../adapters/crypto/passwords.js';
export { createPrismaClient, type PrismaClient } from '../adapters/prisma/client.js';
export { SHIP_PROTOCOL } from '../adapters/trpc/ship-protocol.js';
export { createApp } from '../app.js';
export type { Caller, ShipCaller } from '../domain/shared/caller.js';
export { createUseCases, type UseCases } from '../wiring.js';
export { createCopyOf, createEmptyDatabase, createMigratedDatabase, executeSqlFile } from './database.js';
export { FLEET_URL, OPERATOR, operatorCaller, secretOf } from './fleet.js';
export { newKey } from './keys.js';
export { migrateWhileAnotherHoldsTheLock } from './migrate-lock.js';
export { databaseUrlOf } from './migrated-template.js';
export { refusalOf, unwrap } from './result.js';
