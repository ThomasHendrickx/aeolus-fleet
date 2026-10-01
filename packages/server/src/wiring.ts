import { createIdGenerator, type IdGenerator } from '@aeolus-fleet/common';

import { argon2idPasswordHasher } from './adapters/crypto/passwords.js';
import { mcpUrlOf } from './adapters/mcp/mcp-url.js';
import { cryptoRandomTokens, sha256Hasher } from './adapters/crypto/secrets.js';
import type { PrismaClient } from './adapters/prisma/client.js';
import { createPrismaFleetEventFeed } from './adapters/prisma/event-log.js';
import { createPrismaFleetCounter } from './adapters/prisma/fleet-counter.js';
import { createPrismaShipHistory } from './adapters/prisma/history.js';
import {
  createPrismaFleetListing,
  createPrismaFleetRepository,
  createPrismaShipRepository,
} from './adapters/prisma/registry.js';
import { createPrismaOperatorAccountLookup } from './adapters/prisma/identity.js';
import { createReceiverWakeups } from './adapters/prisma/receiver-wakeups.js';
import { createPrismaCallers, createPrismaUnitOfWork } from './adapters/prisma/unit-of-work.js';
import { createAuthenticate, type Authenticate } from './core/identity/authenticate.js';
import { createResetOperatorPassword, type ResetOperatorPassword } from './core/identity/reset-operator-password.js';
import { createSignIn, type SignIn } from './core/identity/sign-in.js';
import { createSignOut, type SignOut } from './core/identity/sign-out.js';
import { createAcknowledgeDelivery, type AcknowledgeDelivery } from './core/messaging/acknowledge-delivery.js';
import { createCheckInbox, type CheckInbox } from './core/messaging/check-inbox.js';
import { createDismissDelivery, type DismissDelivery } from './core/messaging/dismiss-delivery.js';
import { createMarkDone, type MarkDone } from './core/messaging/mark-done.js';
import { createMarkRead, type MarkRead } from './core/messaging/mark-read.js';
import type { ReceiverWakeups } from './core/messaging/ports.js';
import { createReceiveDeliveries, type ReceiveDeliveries } from './core/messaging/receive-deliveries.js';
import { createReplyToMessage, type ReplyToMessage } from './core/messaging/reply-to-message.js';
import { createResendDelivery, type ResendDelivery } from './core/messaging/resend-delivery.js';
import { createSendMessage, type SendMessage } from './core/messaging/send-message.js';
import { createClaimShip, type ClaimShip } from './core/registry/claim-ship.js';
import { createCommissionShip, type CommissionShip } from './core/registry/commission-ship.js';
import { createDeregister, type Deregister } from './core/registry/deregister.js';
import { createGetStartingPrompt, type GetStartingPrompt } from './core/registry/get-starting-prompt.js';
import { createGetShip, type GetShip } from './core/registry/get-ship.js';
import { createInitialiseFleet, type InitialiseFleet } from './core/registry/initialise-fleet.js';
import { createListFleet, type ListFleet } from './core/registry/list-fleet.js';
import { createListFleets, type ListFleets } from './core/registry/list-fleets.js';
import { createRecrewShip, type RecrewShip } from './core/registry/recrew-ship.js';
import { createReleaseShip, type ReleaseShip } from './core/registry/release-ship.js';
import { createRetireShip, type RetireShip } from './core/registry/retire-ship.js';
import { createWhoami, type Whoami } from './core/registry/whoami.js';
import type { Clock } from './core/shared/clock.js';
import { createPing, type Ping } from './core/shared/ping.js';
import { createReadFleetEvents, type ReadFleetEvents } from './core/shared/read-fleet-events.js';
import { createReadInbox, type ReadInbox } from './core/shared/read-inbox.js';
import { createReadMessage, type ReadMessage } from './core/shared/read-message.js';
import { createReadNeedsAttention, type ReadNeedsAttention } from './core/shared/read-needs-attention.js';
import { createReadShipMessages, type ReadShipMessages } from './core/shared/read-ship-messages.js';
import { createReadShipTimeline, type ReadShipTimeline } from './core/shared/read-ship-timeline.js';

export interface UseCases {
  ping: Ping;
  initialiseFleet: InitialiseFleet;
  listFleets: ListFleets;
  commissionShip: CommissionShip;
  getStartingPrompt: GetStartingPrompt;
  releaseShip: ReleaseShip;
  retireShip: RetireShip;
  recrewShip: RecrewShip;
  listFleet: ListFleet;
  getShip: GetShip;
  claimShip: ClaimShip;
  whoami: Whoami;
  deregister: Deregister;
  sendMessage: SendMessage;
  receiveDeliveries: ReceiveDeliveries;
  acknowledgeDelivery: AcknowledgeDelivery;
  checkInbox: CheckInbox;
  dismissDelivery: DismissDelivery;
  resendDelivery: ResendDelivery;
  markRead: MarkRead;
  markDone: MarkDone;
  replyToMessage: ReplyToMessage;
  readFleetEvents: ReadFleetEvents;
  readShipTimeline: ReadShipTimeline;
  readShipMessages: ReadShipMessages;
  readMessage: ReadMessage;
  readNeedsAttention: ReadNeedsAttention;
  readInbox: ReadInbox;
  signIn: SignIn;
  signOut: SignOut;
  resetOperatorPassword: ResetOperatorPassword;
  authenticate: Authenticate;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Wires every use case to Postgres through Prisma. The HTTP app and the server
 * commands share it. `fleetUrl` is where ships reach the fleet, the public
 * URL: every starting prompt carries the fleet's MCP URL under it.
 *
 * `wakeups` wake a waiting receive; the HTTP app feeds them from the delivery
 * listener. Without them, nothing wakes a receive and it ends only at its
 * wait: enough for the server commands, which never receive.
 */
export function createUseCases(options: {
  prisma: PrismaClient;
  fleetUrl: string;
  clock?: Clock;
  ids?: IdGenerator;
  wakeups?: ReceiverWakeups;
  /** How long a receive waits on an empty inbox; about 25 seconds unless a test says otherwise. */
  receiveWaitMs?: number;
}): UseCases {
  const { prisma } = options;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? createIdGenerator();
  const uow = createPrismaUnitOfWork(prisma);
  const secrets = { hasher: sha256Hasher, random: cryptoRandomTokens };
  const mcpUrl = mcpUrlOf(options.fleetUrl);
  const wakeups = options.wakeups ?? createReceiverWakeups();

  return {
    ping: createPing({ clock, fleets: createPrismaFleetCounter(prisma) }),
    initialiseFleet: createInitialiseFleet({ uow, clock, ids, passwords: argon2idPasswordHasher }),
    listFleets: createListFleets({ fleets: createPrismaFleetRepository(prisma) }),
    commissionShip: createCommissionShip({ uow, clock, ids, secrets, mcpUrl, fleetUrl: options.fleetUrl }),
    getStartingPrompt: createGetStartingPrompt({ uow, clock, ids, secrets, mcpUrl, fleetUrl: options.fleetUrl }),
    releaseShip: createReleaseShip({ uow, clock, ids }),
    retireShip: createRetireShip({ uow, clock, ids }),
    recrewShip: createRecrewShip({ uow, clock, ids, secrets, mcpUrl, fleetUrl: options.fleetUrl }),
    listFleet: createListFleet({ listing: createPrismaFleetListing(prisma) }),
    getShip: createGetShip({ listing: createPrismaFleetListing(prisma) }),
    claimShip: createClaimShip({ uow, clock, ids, secrets }),
    whoami: createWhoami({ ships: createPrismaShipRepository(prisma) }),
    deregister: createDeregister({ uow, clock, ids }),
    sendMessage: createSendMessage({ uow, clock, ids, hasher: sha256Hasher }),
    receiveDeliveries: createReceiveDeliveries({
      uow,
      clock,
      ids,
      wakeups,
      waitMs: options.receiveWaitMs,
    }),
    acknowledgeDelivery: createAcknowledgeDelivery({ uow, clock, ids }),
    checkInbox: createCheckInbox({ uow, clock, wakeups }),
    dismissDelivery: createDismissDelivery({ uow, clock, ids }),
    resendDelivery: createResendDelivery({ uow, clock, ids, hasher: sha256Hasher }),
    markRead: createMarkRead({ uow, clock }),
    markDone: createMarkDone({ uow, clock, ids }),
    replyToMessage: createReplyToMessage({ uow, clock, ids, hasher: sha256Hasher }),
    readFleetEvents: createReadFleetEvents({ feed: createPrismaFleetEventFeed(prisma) }),
    readShipTimeline: createReadShipTimeline({ history: createPrismaShipHistory(prisma) }),
    readShipMessages: createReadShipMessages({ history: createPrismaShipHistory(prisma) }),
    readMessage: createReadMessage({ history: createPrismaShipHistory(prisma) }),
    readNeedsAttention: createReadNeedsAttention({ history: createPrismaShipHistory(prisma) }),
    readInbox: createReadInbox({ history: createPrismaShipHistory(prisma) }),
    signIn: createSignIn({
      uow,
      accounts: createPrismaOperatorAccountLookup(prisma),
      clock,
      ids,
      ...secrets,
      passwords: argon2idPasswordHasher,
    }),
    signOut: createSignOut({ uow, clock, ids }),
    resetOperatorPassword: createResetOperatorPassword({ uow, clock, ids, passwords: argon2idPasswordHasher }),
    authenticate: createAuthenticate({ callers: createPrismaCallers(prisma), hasher: sha256Hasher, clock }),
  };
}
