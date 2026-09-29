/**
 * Outbound port: runs a use case in one database transaction. Everything the
 * work writes through `tx`, events included, commits together or not at all.
 *
 * Each use case names the ports it needs as its own `Tx` type, so it sees only
 * those. The adapter hands every use case one object that holds them all.
 */
export interface UnitOfWork<Tx> {
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}
