// Registry's published surface: what other contexts may use. Use cases are not
// part of it; adapters import them from their own modules.
export { location, refuseEndedLease, type Lease, type LeaseEnded, type LeaseEndReason, type Location } from './lease.js';
export { endLease, holdLease, isLeasePushed, markLeasePushed, takeOverOperatorLease, type HoldLeaseTx, type LeaseTx } from './leases.js';
export type { FleetRepository, InFlightDeliveries, LeaseRepository, ShipRepository } from './ports.js';
export { findPingableShip, type PingableShipTx, type UnpingableShip } from './pingable-ship.js';
export { checkReach, type CheckReachTx, type NotReachable } from './check-reach.js';
export { resolveSelector, type ResolveSelectorTx, type UnresolvableSelector } from './resolve-selector.js';
export { findOperatorShip, findShip, findViewerShip, type FindShipTx, type ShipTx } from './ships.js';
export { isConsoleShip, OPERATOR_SHIP_NAME, type Ship } from './ship.js';
export { appliedLimits, type AppliedLimitsTx } from './applied-limits.js';
export { readsEvent, readsMessage, readsShip, type MessageParties, type ReadReach, type ReadReachOf } from './read-reach.js';
