import {
  idSchema,
  SCOPES,
  type DeliveryId,
  type FleetId,
  type LeaseId,
  type MessageId,
  type Scope,
  type ShipId,
} from '@aeolus-fleet/common';

import { createAuthenticate } from '../../src/core/identity/authenticate.js';
import { createResetOperatorPassword } from '../../src/core/identity/reset-operator-password.js';
import { createSignIn } from '../../src/core/identity/sign-in.js';
import { createSignOut } from '../../src/core/identity/sign-out.js';
import { createAcknowledgeDelivery } from '../../src/core/messaging/acknowledge-delivery.js';
import { createCheckInbox } from '../../src/core/messaging/check-inbox.js';
import { createDismissDelivery } from '../../src/core/messaging/dismiss-delivery.js';
import { createReceiveDeliveries } from '../../src/core/messaging/receive-deliveries.js';
import { createResendDelivery } from '../../src/core/messaging/resend-delivery.js';
import { createSendMessage } from '../../src/core/messaging/send-message.js';
import { createClaimShip } from '../../src/core/registry/claim-ship.js';
import { createCommissionShip } from '../../src/core/registry/commission-ship.js';
import { createDeregister } from '../../src/core/registry/deregister.js';
import { createGetShip } from '../../src/core/registry/get-ship.js';
import { createGetStartingPrompt } from '../../src/core/registry/get-starting-prompt.js';
import { createInitialiseFleet, type FleetInitialised } from '../../src/core/registry/initialise-fleet.js';
import { createListFleet } from '../../src/core/registry/list-fleet.js';
import { createRecrewShip } from '../../src/core/registry/recrew-ship.js';
import { createReleaseShip } from '../../src/core/registry/release-ship.js';
import { createRetireShip } from '../../src/core/registry/retire-ship.js';
import { createWhoami } from '../../src/core/registry/whoami.js';
import type { Caller, Crew } from '../../src/core/shared/caller.js';
import { createReadFleetEvents } from '../../src/core/shared/read-fleet-events.js';
import { createReadMessage } from '../../src/core/shared/read-message.js';
import { createReadNeedsAttention } from '../../src/core/shared/read-needs-attention.js';
import { createReadShipMessages } from '../../src/core/shared/read-ship-messages.js';
import { createReadShipTimeline } from '../../src/core/shared/read-ship-timeline.js';
import type { Recipient } from '../../src/core/shared/selector.js';
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

/** The fleet's public URL in tests: where ships reach it. */
export const FLEET_URL = 'https://fleet.example.com';

/** The fleet's MCP URL, which starting prompts carry in tests: /mcp under the public URL. */
export const FLEET_MCP_URL = `${FLEET_URL}/mcp`;

/** The registry use cases, wired to the in-memory core: the operator's, and the claim and deregister a session makes. */
export function registryUseCases(core: InMemoryCore) {
  const deps = {
    uow: core.uow,
    clock: core.clock,
    ids: core.ids,
    secrets: { hasher: core.hasher, random: core.random },
    mcpUrl: FLEET_MCP_URL,
    fleetUrl: FLEET_URL,
  };
  return {
    commissionShip: createCommissionShip(deps),
    getStartingPrompt: createGetStartingPrompt(deps),
    releaseShip: createReleaseShip(deps),
    retireShip: createRetireShip(deps),
    recrewShip: createRecrewShip(deps),
    claimShip: createClaimShip(deps),
    deregister: createDeregister(deps),
    listFleet: createListFleet({ listing: core.listing }),
    getShip: createGetShip({ listing: core.listing }),
    whoami: createWhoami({ ships: core.ships }),
    readFleetEvents: createReadFleetEvents({ feed: core.feed }),
  };
}

/** The history reads for the ship page, wired to the in-memory core. */
export function historyUseCases(core: InMemoryCore) {
  return {
    readShipTimeline: createReadShipTimeline({ history: core.history }),
    readShipMessages: createReadShipMessages({ history: core.history }),
    readMessage: createReadMessage({ history: core.history }),
    readNeedsAttention: createReadNeedsAttention({ history: core.history }),
  };
}

/** The messaging use cases, wired to the in-memory core; a receive waits on its scripted wake-ups. */
export function messagingUseCases(core: InMemoryCore) {
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids };
  return {
    sendMessage: createSendMessage({ ...deps, hasher: core.hasher }),
    receiveDeliveries: createReceiveDeliveries({ ...deps, wakeups: core.wakeups }),
    acknowledgeDelivery: createAcknowledgeDelivery(deps),
    checkInbox: createCheckInbox({ ...deps, wakeups: core.wakeups }),
    dismissDelivery: createDismissDelivery(deps),
    resendDelivery: createResendDelivery({ ...deps, hasher: core.hasher }),
  };
}

/** An agent ship as the caller, holding the scopes commissioning gives it, as its crew token makes it. */
export function agentCaller(ship: { fleetId: FleetId; shipId: ShipId }): Caller {
  return { ...ship, kind: 'agent', scopes: ['messages:send', 'messages:receive'] };
}

/** argo as the caller, holding every scope, as its secret or console session makes it. */
export function operatorCaller(fleet: FleetInitialised): Caller {
  return { shipId: fleet.operatorShipId, fleetId: fleet.fleetId, kind: 'operator', scopes: [...SCOPES] };
}

/** The id of the delivery a send stored for the message. */
export function deliveryIdOf(core: InMemoryCore, messageId: MessageId): DeliveryId {
  const delivery = core.state.deliveries.find((held) => held.messageId === messageId);
  if (!delivery) {
    throw new Error(`The send of ${messageId} stored no delivery`);
  }
  return delivery.id;
}

/** The ship secret a starting prompt holds. */
export function secretIn(prompt: string): string {
  const secret = /^Ship secret: (\S+)$/m.exec(prompt)?.[1];
  if (secret === undefined) {
    throw new Error(`No ship secret in the starting prompt:\n${prompt}`);
  }
  return secret;
}

/** The fleet's MCP URL a starting prompt holds: where its session connects. */
export function mcpUrlIn(prompt: string): string {
  const url = /^Fleet MCP URL: (\S+)$/m.exec(prompt)?.[1];
  if (url === undefined) {
    throw new Error(`No fleet MCP URL in the starting prompt:\n${prompt}`);
  }
  return url;
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
 * A new session crewing the ship, straight into the state, as its crew token
 * makes it the caller: the ship's agent scopes and the lease it holds.
 */
export function crewAboard(core: InMemoryCore, ship: { fleetId: FleetId; shipId: ShipId }): Crew {
  const leaseId = core.ids('lease');
  core.state.leases.push({
    id: leaseId,
    ...ship,
    location: { kind: 'DEVICE', description: null },
    crewTokenHash: core.hasher.hash(`aeolus_ct_v1_crew-${leaseId}`),
    startedAt: core.clock.now(),
    endedAt: null,
  });
  return { ...agentCaller(ship), leaseId };
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

/** The crew a crew token makes the caller, as the API resolves it. */
export async function crewOfToken(core: InMemoryCore, crewToken: string): Promise<Crew> {
  const crew = await identityUseCases(core).authenticate.byCrewToken(crewToken);
  if (!crew.isOk) {
    throw new Error(`The crew token crews no ship: ${crew.error.message}`);
  }
  return crew.value;
}

/** The id of the ship's open lease. */
export function openLeaseOf(core: InMemoryCore, shipId: ShipId): LeaseId {
  const lease = core.state.leases.find((held) => held.shipId === shipId && held.endedAt === null);
  if (!lease) {
    throw new Error(`Ship ${shipId} holds no open lease`);
  }
  return lease.id;
}

/**
 * A message and its delivery in flight with the given ship and lease, straight
 * into the state: for a lease whose crew never received through the use case,
 * such as argo's console session. The message is the ship's own, to its ship
 * unless a recipient is given.
 */
export function deliveryInFlight(
  core: InMemoryCore,
  held: { fleetId: FleetId; shipId: ShipId; leaseId: LeaseId; recipient?: Recipient; attempts?: number },
): { deliveryId: DeliveryId; messageId: MessageId } {
  const { fleetId, shipId, leaseId, recipient = { kind: 'ship', shipId }, attempts = 1 } = held;
  const at = core.clock.now();
  const messageId = core.ids('message');
  const deliveryId = core.ids('delivery');
  core.state.messages.push({
    id: messageId,
    fleetId,
    senderShipId: shipId,
    selector: recipient,
    payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/28',
    contentType: 'text/plain',
    idempotencyKey: `in-flight-${messageId}`,
    requestHash: `sha256(in-flight-${messageId})`,
    inReplyToMessageId: null,
    resendOfMessageId: null,
    createdAt: at,
  });
  core.state.deliveries.push({
    id: deliveryId,
    fleetId,
    messageId,
    recipient,
    state: 'delivered',
    claimedByShipId: shipId,
    claimedByLeaseId: leaseId,
    attempts,
    createdAt: at,
  });
  return { deliveryId, messageId };
}
