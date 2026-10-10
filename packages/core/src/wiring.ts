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
  createPrismaClearRequestRepository,
  createPrismaCrewRequestRepository,
  createPrismaLeaseRepository,
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
import { createPrismaReachRefusalRepository } from './adapters/prisma/network.js';
import { createPrismaCallers, createPrismaUnitOfWork } from './adapters/prisma/unit-of-work.js';
import { createAuthenticate, type Authenticate } from './domain/identity/authenticate.js';
import { createDismissNotice, type DismissNotice } from './domain/identity/dismiss-notice.js';
import { createGetGuide, type GetGuide } from './domain/identity/get-guide.js';
import { createGetNotices, type GetNotices } from './domain/identity/get-notices.js';
import { createIssueSignInTicket, type IssueSignInTicket } from './domain/identity/issue-sign-in-ticket.js';
import { createRedeemSignInTicket, type RedeemSignInTicket } from './domain/identity/redeem-sign-in-ticket.js';
import { createReadAccount, type ReadAccount } from './domain/identity/read-account.js';
import { createReadGuide, type ReadGuide } from './domain/identity/read-guide.js';
import { createReadNotices, type ReadNotices } from './domain/identity/read-notices.js';
import { createRecordGuideProgress, type RecordGuideProgress } from './domain/identity/record-guide-progress.js';
import { createSetGuide, type SetGuide } from './domain/identity/set-guide.js';
import { createResetOperatorPassword, type ResetOperatorPassword } from './domain/identity/reset-operator-password.js';
import { createSetNotices, type SetNotices } from './domain/identity/set-notices.js';
import { createSetTheme, type SetTheme } from './domain/identity/set-theme.js';
import { createSignIn, type SignIn } from './domain/identity/sign-in.js';
import { createSignOut, type SignOut } from './domain/identity/sign-out.js';
import { createAcknowledgeDelivery, type AcknowledgeDelivery } from './domain/messaging/acknowledge-delivery.js';
import { createAnswerPing, type AnswerPing } from './domain/messaging/answer-ping.js';
import { createCheckInbox, type CheckInbox } from './domain/messaging/check-inbox.js';
import { createDismissDelivery, type DismissDelivery } from './domain/messaging/dismiss-delivery.js';
import { createMarkDone, type MarkDone } from './domain/messaging/mark-done.js';
import { createMarkRead, type MarkRead } from './domain/messaging/mark-read.js';
import type { ReceiverWakeups } from './domain/messaging/ports.js';
import { createReceiveDeliveries, type ReceiveDeliveries } from './domain/messaging/receive-deliveries.js';
import { createReplyToMessage, type ReplyToMessage } from './domain/messaging/reply-to-message.js';
import { createResendDelivery, type ResendDelivery } from './domain/messaging/resend-delivery.js';
import { createPingShip, type PingShip } from './domain/messaging/ping-ship.js';
import { createSendMessage, type SendMessage } from './domain/messaging/send-message.js';
import { createClaimShip, type ClaimShip } from './domain/registry/claim-ship.js';
import { createCommissionShip, type CommissionShip } from './domain/registry/commission-ship.js';
import { createDeregister, type Deregister } from './domain/registry/deregister.js';
import { createGetStartingPrompt, type GetStartingPrompt } from './domain/registry/get-starting-prompt.js';
import { createGetShip, type GetShip } from './domain/registry/get-ship.js';
import { createInitialiseFleet, type InitialiseFleet } from './domain/registry/initialise-fleet.js';
import { createListFleet, type ListFleet } from './domain/registry/list-fleet.js';
import { createListFleets, type ListFleets } from './domain/registry/list-fleets.js';
import { createRecrewShip, type RecrewShip } from './domain/registry/recrew-ship.js';
import { createReleaseShip, type ReleaseShip } from './domain/registry/release-ship.js';
import { createRenameShip, type RenameShip } from './domain/registry/rename-ship.js';
import { createRetireShip, type RetireShip } from './domain/registry/retire-ship.js';
import { createReport, type Report } from './domain/registry/report.js';
import { createRequestCrew, type RequestCrew } from './domain/registry/request-crew.js';
import { createRemoveCrewRequest, type RemoveCrewRequest } from './domain/registry/remove-crew-request.js';
import { createAssignCrew, type AssignCrew } from './domain/registry/assign-crew.js';
import { createReportCrewStatus, type ReportCrewStatus } from './domain/registry/report-crew-status.js';
import { createConfirmCrewRelease, type ConfirmCrewRelease } from './domain/registry/confirm-crew-release.js';
import { createGiveBackCrewRequest, type GiveBack } from './domain/registry/give-back-crew-request.js';
import { createReadAssignedCrewRequests, type ReadAssignedCrewRequests } from './domain/registry/read-assigned-crew-requests.js';
import { createConfirmWorktreeCleared, type ConfirmWorktreeCleared } from './domain/registry/confirm-worktree-cleared.js';
import { createReadClearRequests, type ReadClearRequests } from './domain/registry/read-clear-requests.js';
import { createRequestWorktreeClear, type RequestWorktreeClear } from './domain/registry/request-worktree-clear.js';
import { createExplainCrewRequest, type ExplainCrewRequest } from './domain/registry/explain-crew-request.js';
import { createDefineLabel, type DefineLabel } from './domain/registry/define-label.js';
import { createExplainReach, type ExplainReach } from './domain/registry/explain-reach.js';
import { createReadReachRefusals, type ReadReachRefusals } from './domain/registry/read-reach-refusals.js';
import { createRegisterNetworkPlugin, type RegisterNetworkPlugin } from './domain/registry/register-network-plugin.js';
import { createSetNetworkRules, type SetNetworkRules } from './domain/registry/set-network-rules.js';
import { createUnregisterNetworkPlugin, type UnregisterNetworkPlugin } from './domain/registry/unregister-network-plugin.js';
import { createChangeLabelValues, type ChangeLabelValues } from './domain/registry/change-label-values.js';
import { createAssignLabel, type AssignLabel } from './domain/registry/assign-label.js';
import { createUnassignLabel, type UnassignLabel } from './domain/registry/unassign-label.js';
import { createListLabels, type ListLabels } from './domain/registry/list-labels.js';
import { createDeleteLabel, type DeleteLabel } from './domain/registry/delete-label.js';
import { createFindLabelValue, type FindLabelValue } from './domain/registry/find-label-value.js';
import { createReadReportLog, type ReadReportLog } from './domain/registry/report-log.js';
import { createWhoami, type Whoami } from './domain/registry/whoami.js';
import type { Clock } from './domain/shared/clock.js';
import { createPing, type Ping } from './domain/shared/ping.js';
import { createReadFleetEvents, type ReadFleetEvents } from './domain/shared/read-fleet-events.js';
import { createFollowFleet, type FollowFleet } from './domain/shared/follow-fleet.js';
import type { FleetEventWakeups } from './domain/shared/events.js';
import { createFleetEventWakeups, fleetEventWakeupsOf } from './adapters/prisma/fleet-event-wakeups.js';
import { createCreateFleet, type CreateFleet } from './domain/registry/create-fleet.js';
import { createGetFleetLimits, type GetFleetLimits } from './domain/registry/get-fleet-limits.js';
import { createGetInstallationSettings, type GetInstallationSettings } from './domain/registry/get-installation-settings.js';
import { createSetFleetLimits, type SetFleetLimits } from './domain/registry/set-fleet-limits.js';
import { createSetInstallationSettings, type SetInstallationSettings } from './domain/registry/set-installation-settings.js';
import { createReadFleetLimits, type ReadFleetLimits } from './domain/shared/read-fleet-limits.js';
import { createDeleteFleet, type DeleteFleet } from './domain/registry/delete-fleet.js';
import { createGetInstallationFleet, type GetInstallationFleet } from './domain/registry/get-installation-fleet.js';
import { createListInstallationFleets, type ListInstallationFleets } from './domain/registry/list-installation-fleets.js';
import { createReadInbox, type ReadInbox } from './domain/shared/read-inbox.js';
import { createReadMessage, type ReadMessage } from './domain/shared/read-message.js';
import { createReadNeedsAttention, type ReadNeedsAttention } from './domain/shared/read-needs-attention.js';
import { createReadShipMessages, type ReadShipMessages } from './domain/shared/read-ship-messages.js';
import { createReadShipTimeline, type ReadShipTimeline } from './domain/shared/read-ship-timeline.js';

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
  requestCrew: RequestCrew;
  removeCrewRequest: RemoveCrewRequest;
  assignCrew: AssignCrew;
  reportCrewStatus: ReportCrewStatus;
  confirmCrewRelease: ConfirmCrewRelease;
  giveBackCrewRequest: GiveBack;
  readAssignedCrewRequests: ReadAssignedCrewRequests;
  requestWorktreeClear: RequestWorktreeClear;
  readClearRequests: ReadClearRequests;
  confirmWorktreeCleared: ConfirmWorktreeCleared;
  explainCrewRequest: ExplainCrewRequest;
  defineLabel: DefineLabel;
  setNetworkRules: SetNetworkRules;
  registerNetworkPlugin: RegisterNetworkPlugin;
  unregisterNetworkPlugin: UnregisterNetworkPlugin;
  readReachRefusals: ReadReachRefusals;
  explainReach: ExplainReach;
  changeLabelValues: ChangeLabelValues;
  assignLabel: AssignLabel;
  unassignLabel: UnassignLabel;
  listLabels: ListLabels;
  deleteLabel: DeleteLabel;
  findLabelValue: FindLabelValue;
  reportLog: ReadReportLog;
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
    requestCrew: createRequestCrew({ uow, clock, ids }),
    removeCrewRequest: createRemoveCrewRequest({ uow, clock, ids }),
    assignCrew: createAssignCrew({ uow, clock, ids }),
    reportCrewStatus: createReportCrewStatus({ uow, clock, ids }),
    confirmCrewRelease: createConfirmCrewRelease({ uow, clock, ids }),
    giveBackCrewRequest: createGiveBackCrewRequest({ uow, clock, ids }),
    readAssignedCrewRequests: createReadAssignedCrewRequests({ crewRequests: createPrismaCrewRequestRepository(prisma) }),
    explainCrewRequest: createExplainCrewRequest({ uow, clock, ids }),
    requestWorktreeClear: createRequestWorktreeClear({ uow, clock, ids }),
    readClearRequests: createReadClearRequests({ clearRequests: createPrismaClearRequestRepository(prisma) }),
    confirmWorktreeCleared: createConfirmWorktreeCleared({ uow, clock, ids }),
    defineLabel: createDefineLabel({ uow, clock, ids }),
    setNetworkRules: createSetNetworkRules({ uow, clock, ids }),
    registerNetworkPlugin: createRegisterNetworkPlugin({ uow, clock, ids }),
    unregisterNetworkPlugin: createUnregisterNetworkPlugin({ uow, clock, ids }),
    readReachRefusals: createReadReachRefusals({ reachRefusals: createPrismaReachRefusalRepository(prisma) }),
    explainReach: createExplainReach({ uow, clock }),
    changeLabelValues: createChangeLabelValues({ uow, clock, ids }),
    assignLabel: createAssignLabel({ uow, clock, ids }),
    unassignLabel: createUnassignLabel({ uow, clock, ids }),
    listLabels: createListLabels({ listing: createPrismaFleetListing(prisma) }),
    deleteLabel: createDeleteLabel({ uow, clock, ids }),
    findLabelValue: createFindLabelValue({ listing: createPrismaFleetListing(prisma) }),
    reportLog: createReadReportLog({ leases: createPrismaLeaseRepository(prisma) }),
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
