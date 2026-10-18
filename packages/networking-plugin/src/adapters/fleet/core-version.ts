import { coreVersionRefusal, type VersionFetch } from '@aeolus-fleet/common';

import { ConfigError } from '../../config.js';
import { runningVersion } from '../http/version.js';

/** The oldest core the networking plugin runs against (decision 0049, docs/compatibility.md). */
export const MINIMUM_CORE_VERSION = '0.27.0';

/** Stops the start when the fleet's core is older than the networking plugin needs, or does not say its version. */
export async function requireCoreVersion(fleetUrl: string, fetch: VersionFetch = globalThis.fetch): Promise<void> {
  const refusal = await coreVersionRefusal({ packageName: 'networking-plugin', version: runningVersion(), minimum: MINIMUM_CORE_VERSION, fleetUrl, fetch });
  if (refusal !== undefined) {
    throw new ConfigError(refusal);
  }
}
