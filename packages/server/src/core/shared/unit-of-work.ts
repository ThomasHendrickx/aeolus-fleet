import type { Result } from './result.js';

/**
 * Outbound port: runs a use case in one database transaction. Everything the
 * work writes through `tx`, events included, commits together or not at all:
 * it commits when the work returns an ok result, and rolls back when the work
 * returns a refusal or throws.
 *
 * Each use case names the ports it needs as its own `Tx` type, so it sees only
 * those. The adapter hands every use case one object that holds them all.
 */
export interface UnitOfWork<Tx> {
  run<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>>;
}
