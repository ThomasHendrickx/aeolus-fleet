// Registry's published surface: what other contexts may use. Use cases are not
// part of it; adapters import them from their own modules.
export { location, type Lease, type LeaseEnded, type LeaseEndReason, type Location } from './lease.js';
export { endLease, holdLease, takeOverOperatorLease, type HoldLeaseTx, type LeaseTx } from './leases.js';
export type { InFlightDeliveries, LeaseRepository, ShipRepository } from './ports.js';
export { resolveSelector, type ResolveSelectorTx, type UnresolvableSelector } from './resolve-selector.js';
export { findOperatorShip, findShip, type FindShipTx, type ShipTx } from './ships.js';
export { OPERATOR_SHIP_NAME, type Ship } from './ship.js';
