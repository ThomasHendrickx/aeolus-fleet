/** A read holds the fleet's shared settings lock before taking one snapshot. */
import type { FleetId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

export interface PersonReadUnitOfWork<Tx> {
  run<T, E>(fleetId: FleetId, work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>>;
}
