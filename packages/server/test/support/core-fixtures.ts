import type { FleetId, Scope, ShipId } from '@aeolus-fleet/common';

import { createAuthenticate } from '../../src/core/identity/authenticate.js';
import { createReplaceOperatorSecret } from '../../src/core/identity/replace-operator-secret.js';
import { createSignIn } from '../../src/core/identity/sign-in.js';
import { createSignOut } from '../../src/core/identity/sign-out.js';
import { createInitialiseFleet, type FleetInitialised } from '../../src/core/registry/initialise-fleet.js';
import type { InMemoryCore } from './in-memory.js';
import { unwrap } from './result.js';

/** The identity use cases, wired to the in-memory core. */
export function identityUseCases(core: InMemoryCore) {
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher, random: core.random };
  return {
    signIn: createSignIn(deps),
    signOut: createSignOut(deps),
    replaceOperatorSecret: createReplaceOperatorSecret(deps),
    authenticate: createAuthenticate({ callers: core.callers, hasher: core.hasher, clock: core.clock }),
  };
}

/** Initialises a fleet named `test fleet` through the use case, so argo and its secret exist. */
export async function initialiseFleet(core: InMemoryCore, name = 'test fleet'): Promise<FleetInitialised> {
  const initialised = await createInitialiseFleet({
    uow: core.uow,
    clock: core.clock,
    ids: core.ids,
    secrets: { hasher: core.hasher, random: core.random },
  })({ name });
  return unwrap(initialised);
}

/**
 * Puts an agent ship with a valid secret straight into the state. Commissioning
 * arrives with slice 2; until then tests need a ship that is not argo.
 */
export function addAgentShip(
  core: InMemoryCore,
  ship: { fleetId: FleetId; scopes?: Scope[] },
): { shipId: ShipId; secret: string } {
  const { fleetId, scopes = ['messages:send', 'messages:receive'] } = ship;
  const at = core.clock.now();
  const shipId = core.ids('ship');
  const secret = `aeolus_sk_v1_agent-${shipId}`;
  core.state.ships.push({
    id: shipId,
    fleetId,
    name: `agent-${shipId.slice(-6)}`,
    type: 'reviewer',
    kind: 'agent',
    scopes,
    note: null,
    createdAt: at,
    retiredAt: null,
  });
  core.state.credentials.push({
    id: core.ids('credential'),
    fleetId,
    shipId,
    secretHash: core.hasher.hash(secret),
    issuedAt: at,
    claimedAt: null,
    invalidatedAt: null,
  });
  return { shipId, secret };
}
