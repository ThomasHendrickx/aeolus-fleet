import { createIdGenerator, type IdGenerator } from '@aeolus-fleet/common';

import { argon2idPasswordHasher } from './adapters/crypto/passwords.js';
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
import { createPrismaGuideProgress, createPrismaNoticeDismissals, createPrismaOperatorAccountLookup } from './adapters/prisma/identity.js';
import { createReceiverWakeups } from './adapters/prisma/receiver-wakeups.js';
import {
  createPrismaFleetLimitReads,
  createPrismaGuideRepository,
  createPrismaInstallationFleets,
  createPrismaInstallationSettings,
  createPrismaNoticeRepository,
} from './adapters/prisma/installation.js';
import { createPrismaCallers, createPrismaUnitOfWork } from './adapters/prisma/unit-of-work.js';
import { createAuthenticate, type Authenticate } from './core/identity/authenticate.js';
import { createDismissNotice, type DismissNotice } from './core/identity/dismiss-notice.js';
import { createGetGuide, type GetGuide } from './core/identity/get-guide.js';
import { createGetNotices, type GetNotices } from './core/identity/get-notices.js';
import { createIssueSignInTicket, type IssueSignInTicket } from './core/identity/issue-sign-in-ticket.js';
import { createRedeemSignInTicket, type RedeemSignInTicket } from './core/identity/redeem-sign-in-ticket.js';
import { createReadAccount, type ReadAccount } from './core/identity/read-account.js';
import { createReadGuide, type ReadGuide } from './core/identity/read-guide.js';
import { createReadNotices, type ReadNotices } from './core/identity/read-notices.js';
import { createRecordGuideProgress, type RecordGuideProgress } from './core/identity/record-guide-progress.js';
import { createSetGuide, type SetGuide } from './core/identity/set-guide.js';
import { createResetOperatorPassword, type ResetOperatorPassword } from './core/identity/reset-operator-password.js';
import { createSetNotices, type SetNotices } from './core/identity/set-notices.js';
import { createSetTheme, type SetTheme } from './core/identity/set-theme.js';
import { createSignIn, type SignIn } from './core/identity/sign-in.js';
import { createSignOut, type SignOut } from './core/identity/sign-out.js';
import { createAcknowledgeDelivery, type AcknowledgeDelivery } from './core/messaging/acknowledge-delivery.js';
import { createAnswerPing, type AnswerPing } from './core/messaging/answer-ping.js';
import { createCheckInbox, type CheckInbox } from './core/messaging/check-inbox.js';
import { createDismissDelivery, type DismissDelivery } from './core/messaging/dismiss-delivery.js';
import { createMarkDone, type MarkDone } from './core/messaging/mark-done.js';
import { createMarkRead, type MarkRead } from './core/messaging/mark-read.js';
import type { ReceiverWakeups } from './core/messaging/ports.js';
import { createReceiveDeliveries, type ReceiveDeliveries } from './core/messaging/receive-deliveries.js';
import { createReplyToMessage, type ReplyToMessage } from './core/messaging/reply-to-message.js';
import { createResendDelivery, type ResendDelivery } from './core/messaging/resend-delivery.js';
import { createPingShip, type PingShip } from './core/messaging/ping-ship.js';
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
import { createRenameShip, type RenameShip } from './core/registry/rename-ship.js';
import { createRetireShip, type RetireShip } from './core/registry/retire-ship.js';
import { createReport, type Report } from './core/registry/report.js';
import { createWhoami, type Whoami } from './core/registry/whoami.js';
import type { Clock } from './core/shared/clock.js';
import { createPing, type Ping } from './core/shared/ping.js';
import { createReadFleetEvents, type ReadFleetEvents } from './core/shared/read-fleet-events.js';
import { createFollowFleet, type FollowFleet } from './core/shared/follow-fleet.js';
import type { FleetEventWakeups } from './core/shared/events.js';
import { createFleetEventWakeups, fleetEventWakeupsOf } from './adapters/prisma/fleet-event-wakeups.js';
import { createCreateFleet, type CreateFleet } from './core/registry/create-fleet.js';
import { createGetFleetLimits, type GetFleetLimits } from './core/registry/get-fleet-limits.js';
import { createGetInstallationSettings, type GetInstallationSettings } from './core/registry/get-installation-settings.js';
import { createSetFleetLimits, type SetFleetLimits } from './core/registry/set-fleet-limits.js';
import { createSetInstallationSettings, type SetInstallationSettings } from './core/registry/set-installation-settings.js';
import { createReadFleetLimits, type ReadFleetLimits } from './core/shared/read-fleet-limits.js';
import { createDeleteFleet, type DeleteFleet } from './core/registry/delete-fleet.js';
import { createGetInstallationFleet, type GetInstallationFleet } from './core/registry/get-installation-fleet.js';
import { createListInstallationFleets, type ListInstallationFleets } from './core/registry/list-installation-fleets.js';
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
  renameShip: RenameShip;
  recrewShip: RecrewShip;
  listFleet: ListFleet;
  getShip: GetShip;
  claimShip: ClaimShip;
  whoami: Whoami;
  report: Report;
  deregister: Deregister;
  sendMessage: SendMessage;
  receiveDeliveries: ReceiveDeliveries;
  acknowledgeDelivery: AcknowledgeDelivery;
  answerPing: AnswerPing;
  pingShip: PingShip;
  checkInbox: CheckInbox;
  dismissDelivery: DismissDelivery;
  resendDelivery: ResendDelivery;
  markRead: MarkRead;
  markDone: MarkDone;
  replyToMessage: ReplyToMessage;
  readFleetEvents: ReadFleetEvents;
  followFleet: FollowFleet;
  readShipTimeline: ReadShipTimeline;
  readShipMessages: ReadShipMessages;
  readMessage: ReadMessage;
  readNeedsAttention: ReadNeedsAttention;
  readInbox: ReadInbox;
  signIn: SignIn;
  signOut: SignOut;
  readAccount: ReadAccount;
  setTheme: SetTheme;
  setNotices: SetNotices;
  getNotices: GetNotices;
  readNotices: ReadNotices;
  dismissNotice: DismissNotice;
  setGuide: SetGuide;
  getGuide: GetGuide;
  readGuide: ReadGuide;
  recordGuideProgress: RecordGuideProgress;
  resetOperatorPassword: ResetOperatorPassword;
  authenticate: Authenticate;
  createFleet: CreateFleet;
  deleteFleet: DeleteFleet;
  listInstallationFleets: ListInstallationFleets;
  getInstallationFleet: GetInstallationFleet;
  issueSignInTicket: IssueSignInTicket;
  redeemSignInTicket: RedeemSignInTicket;
  getInstallationSettings: GetInstallationSettings;
  setInstallationSettings: SetInstallationSettings;
  getFleetLimits: GetFleetLimits;
  setFleetLimits: SetFleetLimits;
  readFleetLimits: ReadFleetLimits;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Wires every use case to Postgres through Prisma. The HTTP app and the server
 * commands share it.
 *
 * `wakeups` wake a waiting receive; the HTTP app feeds them from the delivery
 * listener. Without them, nothing wakes a receive and it ends only at its
 * wait: enough for the server commands, which never receive.
 */
export function createUseCases(options: {
  prisma: PrismaClient;
  clock?: Clock;
  ids?: IdGenerator;
  wakeups?: ReceiverWakeups;
  /** Wake a waiting follow; without them a follow ends only at its wait. */
  fleetEventWakeups?: FleetEventWakeups;
  /** How long a receive waits on an empty inbox; about 25 seconds unless a test says otherwise. */
  receiveWaitMs?: number;
}): UseCases {
  const { prisma } = options;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? createIdGenerator();
  const uow = createPrismaUnitOfWork(prisma);
  const secrets = { hasher: sha256Hasher, random: cryptoRandomTokens };
  const wakeups = options.wakeups ?? createReceiverWakeups();
  const notices = createPrismaNoticeRepository(prisma);
  const dismissals = createPrismaNoticeDismissals(prisma);
  const guide = createPrismaGuideRepository(prisma);
  const guideProgress = createPrismaGuideProgress(prisma);

  return {
    ping: createPing({ clock, fleets: createPrismaFleetCounter(prisma) }),
    initialiseFleet: createInitialiseFleet({ uow, clock, ids, passwords: argon2idPasswordHasher }),
    listFleets: createListFleets({ fleets: createPrismaFleetRepository(prisma) }),
    createFleet: createCreateFleet({ uow, clock, ids, hasher: sha256Hasher }),
    deleteFleet: createDeleteFleet({ uow, clock, hasher: sha256Hasher }),
    issueSignInTicket: createIssueSignInTicket({ uow, clock, ids, hasher: sha256Hasher, random: cryptoRandomTokens }),
    getInstallationSettings: createGetInstallationSettings({ settings: createPrismaInstallationSettings(prisma) }),
    setInstallationSettings: createSetInstallationSettings({ uow }),
    getFleetLimits: createGetFleetLimits({ uow }),
    setFleetLimits: createSetFleetLimits({ uow, clock, ids }),
    setNotices: createSetNotices({ notices }),
    getNotices: createGetNotices({ notices }),
    readNotices: createReadNotices({ notices, dismissals }),
    dismissNotice: createDismissNotice({ notices, dismissals, clock }),
    setGuide: createSetGuide({ guide }),
    getGuide: createGetGuide({ guide }),
    readGuide: createReadGuide({ guide, progress: guideProgress }),
    recordGuideProgress: createRecordGuideProgress({ guide, progress: guideProgress, clock }),
    readFleetLimits: createReadFleetLimits({ limits: createPrismaFleetLimitReads(prisma), clock }),
    redeemSignInTicket: createRedeemSignInTicket({ uow, clock, ids, hasher: sha256Hasher, random: cryptoRandomTokens }),
    listInstallationFleets: createListInstallationFleets({ fleets: createPrismaInstallationFleets(prisma), settings: createPrismaInstallationSettings(prisma), clock }),
    getInstallationFleet: createGetInstallationFleet({ fleets: createPrismaInstallationFleets(prisma), settings: createPrismaInstallationSettings(prisma), clock }),
    commissionShip: createCommissionShip({ uow, clock, ids, secrets }),
    getStartingPrompt: createGetStartingPrompt({ uow, clock, ids, secrets }),
    releaseShip: createReleaseShip({ uow, clock, ids }),
    retireShip: createRetireShip({ uow, clock, ids }),
    renameShip: createRenameShip({ uow, clock, ids }),
    recrewShip: createRecrewShip({ uow, clock, ids, secrets }),
    listFleet: createListFleet({ listing: createPrismaFleetListing(prisma) }),
    getShip: createGetShip({ listing: createPrismaFleetListing(prisma) }),
    claimShip: createClaimShip({ uow, clock, ids, secrets }),
    whoami: createWhoami({ ships: createPrismaShipRepository(prisma) }),
    report: createReport({ uow, clock, ids }),
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
    answerPing: createAnswerPing({ uow, clock, ids }),
    pingShip: createPingShip({ uow, clock, ids, hasher: sha256Hasher }),
    checkInbox: createCheckInbox({ uow, clock, wakeups }),
    dismissDelivery: createDismissDelivery({ uow, clock, ids }),
    resendDelivery: createResendDelivery({ uow, clock, ids, hasher: sha256Hasher }),
    markRead: createMarkRead({ uow, clock }),
    markDone: createMarkDone({ uow, clock, ids }),
    replyToMessage: createReplyToMessage({ uow, clock, ids, hasher: sha256Hasher }),
    readFleetEvents: createReadFleetEvents({ feed: createPrismaFleetEventFeed(prisma) }),
    followFleet: createFollowFleet({
      feed: createPrismaFleetEventFeed(prisma),
      clock,
      wakeups: options.fleetEventWakeups ?? fleetEventWakeupsOf(createFleetEventWakeups()),
    }),
    readShipTimeline: createReadShipTimeline({ history: createPrismaShipHistory(prisma) }),
    readShipMessages: createReadShipMessages({ history: createPrismaShipHistory(prisma) }),
    readMessage: createReadMessage({ history: createPrismaShipHistory(prisma) }),
    readNeedsAttention: createReadNeedsAttention({ history: createPrismaShipHistory(prisma) }),
    readInbox: createReadInbox({ history: createPrismaShipHistory(prisma), ships: createPrismaShipRepository(prisma) }),
    signIn: createSignIn({
      uow,
      accounts: createPrismaOperatorAccountLookup(prisma),
      clock,
      ids,
      ...secrets,
      passwords: argon2idPasswordHasher,
    }),
    signOut: createSignOut({ uow, clock, ids }),
    readAccount: createReadAccount({ uow }),
    setTheme: createSetTheme({ uow }),
    resetOperatorPassword: createResetOperatorPassword({ uow, clock, ids, passwords: argon2idPasswordHasher }),
    authenticate: createAuthenticate({ callers: createPrismaCallers(prisma), hasher: sha256Hasher, clock }),
  };
}
