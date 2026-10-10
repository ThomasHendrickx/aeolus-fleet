import type { NetworkPluginDeclaration } from '@aeolus-fleet/common';

import type { FleetNetwork } from './ports.js';

/**
 * What the networking plugin declares for a fleet until argo sets it (Thomas
 * on #260): it keeps the rules it supplied last while unavailable, and is not
 * responding after five minutes without a call.
 */
export const DEFAULT_DECLARATION: NetworkPluginDeclaration = { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 };

/** A fleet's network as argo last saved it, or the plugin's start: no rules, all-to-all, and the default declaration. */
export function networkOf(saved: FleetNetwork | undefined): FleetNetwork {
  return saved ?? { rules: null, declaration: DEFAULT_DECLARATION };
}
