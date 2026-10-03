import type { FleetId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../management/ports.js';
import type { Result } from '../shared/result.js';

/**
 * Outbound port: asks the fleet whether a forwarded console session cookie is
 * a signed-in operator's (`console.session`, decision 0012).
 */
export interface ConsoleSessions {
  check(cookie: string): Promise<Result<{ fleetId: FleetId }, FleetRefusal>>;
}
