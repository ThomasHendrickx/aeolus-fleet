import { idSchema, SCOPES, type FleetId, type Scope, type ShipId } from '@aeolus-fleet/common';

import { createAuthenticate } from '../../src/core/identity/authenticate.js';
import { createResetOperatorPassword } from '../../src/core/identity/reset-operator-password.js';
import { createSignIn } from '../../src/core/identity/sign-in.js';
import { createSignOut } from '../../src/core/identity/sign-out.js';
import { createSendMessage } from '../../src/core/messaging/send-message.js';
import { createClaimShip } from '../../src/core/registry/claim-ship.js';
import { createCommissionShip } from '../../src/core/registry/commission-ship.js';
import { createGetStartingPrompt } from '../../src/core/registry/get-starting-prompt.js';
import { createInitialiseFleet, type FleetInitialised } from '../../src/core/registry/initialise-fleet.js';
import { createListFleet } from '../../src/core/registry/list-fleet.js';
import { createWhoami } from '../../src/core/registry/whoami.js';
import type { Caller } from '../../src/core/shared/caller.js';
import type { InMemoryCore } from './in-memory.js';
import { unwrap } from './result.js';

/** The identity use cases, wired to the in-memory core. */
export function identityUseCases(core: InMemoryCore) {
  const deps = {
    uow: core.uow,
    accounts: core.accounts,
    clock: core.clock,
    ids: core.ids,
    hasher: core.hasher,
    random: core.random,
    passwords: core.passwords,
  };
  return {
    signIn: createSignIn(deps),
    signOut: createSignOut(deps),
    resetOperatorPassword: createResetOperatorPassword(deps),
    authenticate: createAuthenticate({ callers: core.callers, hasher: core.hasher, clock: core.clock }),
  };
}

/** The fleet URL starting prompts carry in tests. */
export const FLEET_URL = 'https://fleet.example.com';

/** The registry use cases, wired to the in-memory core: the operator's, and the claim a session makes. */
export function registryUseCases(core: InMemoryCore) {
  const deps = {
    uow: core.uow,
    clock: core.clock,
    ids: core.ids,
    secrets: { hasher: core.hasher, random: core.random },
    fleetUrl: FLEET_URL,
  };
  return {
    commissionShip: createCommissionShip(deps),
    getStartingPrompt: createGetStartingPrompt(deps),
    claimShip: createClaimShip(deps),
    listFleet: createListFleet({ listing: core.listing }),
    whoami: createWhoami({ ships: core.ships }),
  };
}

/** The messaging use cases, wired to the in-memory core. */
export function messagingUseCases(core: InMemoryCore) {
  return { sendMessage: createSendMessage({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher }) };
}

/** An agent ship as the caller, holding the scopes commissioning gives it, as its crew token makes it. */
export function agentCaller(ship: { fleetId: FleetId; shipId: ShipId }): Caller {
  return { ...ship, kind: 'agent', scopes: ['messages:send', 'messages:receive'] };
}

/** argo as the caller, holding every scope, as its secret or console session makes it. */
export function operatorCaller(fleet: FleetInitialised): Caller {
  return { shipId: fleet.operatorShipId, fleetId: fleet.fleetId, kind: 'operator', scopes: [...SCOPES] };
}

/** The ship secret a starting prompt holds. */
export function secretIn(prompt: string): string {
  const secret = /^Ship secret: (\S+)$/m.exec(prompt)?.[1];
  if (secret === undefined) {
    throw new Error(`No ship secret in the starting prompt:\n${prompt}`);
  }
  return secret;
}

/** The ship id a starting prompt holds. */
export function shipIdIn(prompt: string): ShipId {
  const shipId = /^Ship id: (\S+)$/m.exec(prompt)?.[1];
  const parsed = idSchema('ship').safeParse(shipId);
  if (!parsed.success) {
    throw new Error(`No ship id in the starting prompt:\n${prompt}`);
  }
  return parsed.data;
}

/** The operator's login in tests: what fleet init asks for, and sign-in takes. */
export const OPERATOR = { email: 'operator@example.com', password: 'correct horse battery staple' };

/** Initialises a fleet named `test fleet` through the use case, so argo and the operator account exist. */
export async function initialiseFleet(core: InMemoryCore, name = 'test fleet'): Promise<FleetInitialised> {
  const initialised = await createInitialiseFleet({
    uow: core.uow,
    clock: core.clock,
    ids: core.ids,
    passwords: core.passwords,
  })({ name, ...OPERATOR });
  return unwrap(initialised);
}

/**
 * Puts an agent ship with a valid secret straight into the state, without
 * commissioning it: for a ship with other scopes, in another fleet or already
 * retired, which commissioning never makes.
 */
export function addAgentShip(
  core: InMemoryCore,
  ship: { fleetId: FleetId; name?: string; type?: string; scopes?: Scope[]; retiredAt?: Date },
): { shipId: ShipId; secret: string } {
  const { fleetId, type = 'reviewer', scopes = ['messages:send', 'messages:receive'], retiredAt = null } = ship;
  const at = core.clock.now();
  const shipId = core.ids('ship');
  const secret = `aeolus_sk_v1_agent-${shipId}`;
  core.state.ships.push({
    id: shipId,
    fleetId,
    name: ship.name ?? `agent-${shipId.slice(-6)}`,
    type,
    kind: 'agent',
    scopes,
    note: null,
    createdAt: at,
    retiredAt,
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

/**
 * A session crewing the ship, straight into the state, without its secret:
 * for a ship whose secret the test does not hold. Returns the crew token.
 */
export function crewShip(core: InMemoryCore, ship: { fleetId: FleetId; shipId: ShipId }): string {
  const crewToken = `aeolus_ct_v1_crew-${ship.shipId}`;
  core.state.leases.push({
    id: core.ids('lease'),
    ...ship,
    location: { kind: 'DEVICE', description: null },
    crewTokenHash: core.hasher.hash(crewToken),
    startedAt: core.clock.now(),
    endedAt: null,
  });
  return crewToken;
}
