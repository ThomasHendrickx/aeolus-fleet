import type { FleetId, NetworkPluginDeclaration, NetworkRule } from '@aeolus-fleet/common';

/**
 * What the networking plugin holds of one fleet's network (decision 0035):
 * the rules argo edits, the whole list or none for all-to-all, and what it
 * declares for while it is unavailable, which argo sets too. The fleet keeps
 * only the list the plugin last supplied.
 */
export interface FleetNetwork {
  rules: readonly NetworkRule[] | null;
  declaration: NetworkPluginDeclaration;
}

/** Outbound port: each fleet's network as argo last saved it; none before the first save. */
export interface FleetNetworks {
  find(fleetId: FleetId): Promise<FleetNetwork | undefined>;
  save(fleetId: FleetId, network: FleetNetwork): Promise<void>;
}
