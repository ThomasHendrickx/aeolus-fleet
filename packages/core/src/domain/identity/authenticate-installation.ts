import type { FleetId, Scope } from '@aeolus-fleet/common';

import type { InstallationCaller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { HostedFleets } from './ports.js';

/**
 * The scopes the installation holds in every fleet it hosts (decision 0020):
 * what its jobs need of the catalogue, in its order (decision 0053): reading
 * the fleet, managing, defining and assigning labels, commissioning person
 * ships and connecting plugin ships with their scopes. Crew assignment and
 * running and alerts support the plugins. Until a call lets argo
 * change them, they are the same in every fleet.
 */
export const INSTALLATION_SCOPES: readonly Scope[] = ['fleet:read', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:person', 'labels:any', 'fleet:connect', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify', 'fleet:alert'];

export type AuthenticateInstallation = (call: { fleetId: FleetId }) => Promise<Result<InstallationCaller, DomainError<'FLEET_NOT_FOUND'>>>;

/**
 * Use case: the installation, whose token the API adapter checked, acts in
 * one fleet it hosts through the same fleet calls as any actor (decision
 * 0057), with its scopes there and its built-in manage rule.
 */
export function createAuthenticateInstallation(deps: { fleets: HostedFleets }): AuthenticateInstallation {
  return async ({ fleetId }) =>
    (await deps.fleets.isHosted(fleetId))
      ? ok({ kind: 'installation', fleetId, scopes: INSTALLATION_SCOPES })
      : refuse('FLEET_NOT_FOUND', `This installation hosts no fleet ${fleetId}`);
}
