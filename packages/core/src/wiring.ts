import { createIdGenerator, type IdGenerator } from '@aeolus-fleet/common';

import { argon2idPasswordHasher } from './adapters/crypto/passwords.js';
import { cryptoRandomTokens, sha256Hasher } from './adapters/crypto/secrets.js';
import type { PrismaClient } from './adapters/prisma/client.js';
import { createPrismaFleetEventFeed } from './adapters/prisma/event-log.js';
import { createPrismaFleetCounter } from './adapters/prisma/fleet-counter.js';
import { createPrismaShipHistory } from './adapters/prisma/history.js';
import { createPrismaHealthRecords } from './adapters/prisma/health.js';
import { createPrismaHealthSnapshots } from './adapters/prisma/health-snapshots.js';
import { createPrismaPushedCrews } from './adapters/prisma/overdue.js';
import {
  createPrismaFleetListing,
  createPrismaFleetRepository,
  createPrismaClearRequestRepository,
  createPrismaCrewRequestRepository,
  createPrismaLeaseRepository,
  createPrismaShipRepository,
} from './adapters/prisma/registry.js';
import {
  createPrismaAccountCutOffs,
  createPrismaGuideProgress,
  createPrismaHostedFleets,
  createPrismaNoticeDismissals,
  createPrismaOperatorAccountLookup,
} from './adapters/prisma/identity.js';
import { createReceiverWakeups } from './adapters/prisma/receiver-wakeups.js';
import {
  createPrismaFleetLimitReads,
  createPrismaGuideRepository,
  createPrismaInstallationFleets,
  createPrismaInstallationSettings,
  createPrismaNoticeRepository,
} from './adapters/prisma/installation.js';
import { createPrismaDeclaredNetworkRulesRepository, createPrismaReachRefusalRepository } from './adapters/prisma/network.js';
import { createPrismaScopeNamespaceRepository } from './adapters/prisma/scope-namespaces.js';
import { createPrismaBulkUnitOfWork, createPrismaCallers, createPrismaSnapshotUnitOfWork, createPrismaUnitOfWork } from './adapters/prisma/unit-of-work.js';
import { createAuthenticate, type Authenticate } from './domain/identity/authenticate.js';
import { createAuthenticateAccount, type AuthenticateAccount } from './domain/identity/authenticate-account.js';
import { createAuthenticateInstallation, type AuthenticateInstallation } from './domain/identity/authenticate-installation.js';
import { createCutOffAccount, type CutOffAccount } from './domain/identity/cut-off-account.js';
import { createSignOutAccount, type SignOutAccount } from './domain/identity/sign-out-account.js';
import type { AccountTokenSignatures } from './domain/identity/ports.js';
import { createDismissNotice, type DismissNotice } from './domain/identity/dismiss-notice.js';
import { createGetGuide, type GetGuide } from './domain/identity/get-guide.js';
import { createGetNotices, type GetNotices } from './domain/identity/get-notices.js';
import { createIssueSignInLink, type IssueSignInLink } from './domain/identity/issue-sign-in-link.js';
import { createIssueSignInTicket, type IssueSignInTicket } from './domain/identity/issue-sign-in-ticket.js';
import { createRedeemSignInTicket, type RedeemSignInTicket } from './domain/identity/redeem-sign-in-ticket.js';
import { createReadAccount, type ReadAccount } from './domain/identity/read-account.js';
import { createReadArgoSignIn, type ReadArgoSignIn } from './domain/identity/read-argo-sign-in.js';
import { createReadGuide, type ReadGuide } from './domain/identity/read-guide.js';
import { createReadNotices, type ReadNotices } from './domain/identity/read-notices.js';
import { createRecordGuideProgress, type RecordGuideProgress } from './domain/identity/record-guide-progress.js';
import { createSetGuide, type SetGuide } from './domain/identity/set-guide.js';
import { createResetOperatorPassword, type ResetOperatorPassword } from './domain/identity/reset-operator-password.js';
import { createSetNotices, type SetNotices } from './domain/identity/set-notices.js';
import { createSetOperatorLogin, type SetOperatorLogin } from './domain/identity/set-operator-login.js';
import { createSetTheme, type SetTheme } from './domain/identity/set-theme.js';
import { createSignIn, type SignIn } from './domain/identity/sign-in.js';
import { createSignOut, type SignOut } from './domain/identity/sign-out.js';
import { createAcknowledgeDelivery, type AcknowledgeDelivery } from './domain/messaging/acknowledge-delivery.js';
import { createHandOverDelivery, type HandOverDelivery } from './domain/messaging/hand-over-delivery.js';
import { createReadDelivery, type ReadDelivery } from './domain/messaging/read-delivery.js';
import { createReportHandled, type ReportHandled } from './domain/messaging/report-handled.js';
import { createReportNotHandled, type ReportNotHandled } from './domain/messaging/report-not-handled.js';
import { createTellOverdueDeliveries, type TellOverdueDeliveries } from './domain/messaging/tell-overdue-deliveries.js';
import { createAnswerPing, type AnswerPing } from './domain/messaging/answer-ping.js';
import { createCheckInbox, type CheckInbox } from './domain/messaging/check-inbox.js';
import { createDismissDelivery, type DismissDelivery } from './domain/messaging/dismiss-delivery.js';
import { createMarkDone, type MarkDone } from './domain/messaging/mark-done.js';
import { createMarkRead, type MarkRead } from './domain/messaging/mark-read.js';
import type { ReceiverWakeups } from './domain/messaging/ports.js';
import { createPushReceiveDeliveries, type PushReceiveDeliveries } from './domain/messaging/push-receive-deliveries.js';
import { createReceiveDeliveries, type ReceiveDeliveries } from './domain/messaging/receive-deliveries.js';
import { createReceiveReply, type ReceiveReply } from './domain/messaging/receive-reply.js';
import { createReplyToMessage, type ReplyToMessage } from './domain/messaging/reply-to-message.js';
import { createResendDelivery, type ResendDelivery } from './domain/messaging/resend-delivery.js';
import { createPingShip, type PingShip } from './domain/messaging/ping-ship.js';
import { createSendMessage, type SendMessage } from './domain/messaging/send-message.js';
import { createClaimShip, type ClaimShip } from './domain/registry/claim-ship.js';
import { createCommissionShip, type CommissionShip } from './domain/registry/commission-ship.js';
import { createDeregister, type Deregister } from './domain/registry/deregister.js';
import { createGetStartingPrompt, type GetStartingPrompt } from './domain/registry/get-starting-prompt.js';
import { createGetShip, type GetShip } from './domain/registry/get-ship.js';
import { createReadOnBehalf, type ReadOnBehalf } from './domain/registry/read-on-behalf.js';
import { createInitialiseFleet, type InitialiseFleet } from './domain/registry/initialise-fleet.js';
import { createListFleet, type ListFleet } from './domain/registry/list-fleet.js';
import { createReadReachOf } from './domain/registry/read-reach.js';
import { createListFleets, type ListFleets } from './domain/registry/list-fleets.js';
import { createRecrewShip, type RecrewShip } from './domain/registry/recrew-ship.js';
import { createReleaseShip, type ReleaseShip } from './domain/registry/release-ship.js';
import { createRenameShip, type RenameShip } from './domain/registry/rename-ship.js';
import { createSetOwner, type SetOwner } from './domain/registry/set-owner.js';
import { createSetVerifiedFacts, type SetVerifiedFacts } from './domain/registry/set-verified-facts.js';
import { createRetireShip, type RetireShip } from './domain/registry/retire-ship.js';
import { createReport, type Report } from './domain/registry/report.js';
import { createSetStatement, type SetStatement } from './domain/registry/set-statement.js';
import { createDiscover, type Discover } from './domain/registry/discover.js';
import { createReportTurn, type ReportTurn } from './domain/registry/report-turn.js';
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
import { createDeclareScopes, type DeclareScopes } from './domain/registry/declare-scopes.js';
import { createGrantScopes, type GrantScopes } from './domain/registry/grant-scopes.js';
import { createDefineLabel, type DefineLabel } from './domain/registry/define-label.js';
import { createExplainReach, type ExplainReach } from './domain/registry/explain-reach.js';
import { createReadReachRefusals, type ReadReachRefusals } from './domain/registry/read-reach-refusals.js';
import { createDeclareNetworkRules, type DeclareNetworkRules } from './domain/registry/declare-network-rules.js';
import { createReadDeclaredNetworkRules, type ReadDeclaredNetworkRules } from './domain/registry/read-declared-network-rules.js';
import { createApplyNetworkRules, type ApplyNetworkRules } from './domain/registry/apply-network-rules.js';
import { createDiscardNetworkRulesDraft, type DiscardNetworkRulesDraft } from './domain/registry/discard-network-rules-draft.js';
import { createReadNetworkRules, type ReadNetworkRules } from './domain/registry/read-network-rules.js';
import { createReadNetworkRulesDraftChanges, type ReadNetworkRulesDraftChanges } from './domain/registry/read-network-rules-draft-changes.js';
import { createSaveNetworkRulesDraft, type SaveNetworkRulesDraft } from './domain/registry/save-network-rules-draft.js';
import { createReadBuiltInRules, type ReadBuiltInRules } from './domain/registry/read-built-in-rules.js';
import { createSetBuiltInRule, type SetBuiltInRule } from './domain/registry/set-built-in-rule.js';
import { createChangeLabelValues, type ChangeLabelValues } from './domain/registry/change-label-values.js';
import { createAssignLabel, type AssignLabel } from './domain/registry/assign-label.js';
import { createUnassignLabel, type UnassignLabel } from './domain/registry/unassign-label.js';
import { createListLabels, type ListLabels } from './domain/registry/list-labels.js';
import { createListScopes, type ListScopes } from './domain/registry/list-scopes.js';
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
import { createReadFleetName, type ReadFleetName } from './domain/registry/read-fleet-name.js';
import { createGetInstallationSettings, type GetInstallationSettings } from './domain/registry/get-installation-settings.js';
import { createSetFleetLimits, type SetFleetLimits } from './domain/registry/set-fleet-limits.js';
import { createSetInstallationSettings, type SetInstallationSettings } from './domain/registry/set-installation-settings.js';
import { createReadFleetLimits, type ReadFleetLimits } from './domain/shared/read-fleet-limits.js';
import { createDeleteFleet, type DeleteFleet } from './domain/registry/delete-fleet.js';
import { createGetInstallationFleet, type GetInstallationFleet } from './domain/registry/get-installation-fleet.js';
import { createListInstallationFleets, type ListInstallationFleets } from './domain/registry/list-installation-fleets.js';
import { createReadInbox, type ReadInbox } from './domain/shared/read-inbox.js';
import { createCountOpenInbox, type CountOpenInbox } from './domain/shared/count-open-inbox.js';
import { createReadInboxMessage, type ReadInboxMessage } from './domain/shared/read-inbox-message.js';
import { createReadInboxWithdrawals, type ReadInboxWithdrawals } from './domain/shared/read-inbox-withdrawals.js';
import { createReadMessage, type ReadMessage } from './domain/shared/read-message.js';
import { createReadSentMessage, type ReadSentMessage } from './domain/shared/read-sent-message.js';
import { createReadShipWay, type ReadShipWay } from './domain/shared/read-ship-way.js';
import { createReadNeedsAttention, type ReadNeedsAttention } from './domain/shared/read-needs-attention.js';
import { createReadHealth, type ReadHealth } from './domain/shared/read-health.js';
import { createCloseHealthSnapshots, type CloseHealthSnapshots } from './domain/shared/close-health-snapshots.js';
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
  setOwner: SetOwner;
  setVerifiedFacts: SetVerifiedFacts;
  recrewShip: RecrewShip;
  listFleet: ListFleet;
  getShip: GetShip;
  readOnBehalf: ReadOnBehalf;
  claimShip: ClaimShip;
  whoami: Whoami;
  report: Report;
  setStatement: SetStatement;
  discover: Discover;
  reportTurn: ReportTurn;
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
  declareScopes: DeclareScopes;
  grantScopes: GrantScopes;
  listScopes: ListScopes;
  saveNetworkRulesDraft: SaveNetworkRulesDraft;
  discardNetworkRulesDraft: DiscardNetworkRulesDraft;
  applyNetworkRules: ApplyNetworkRules;
  readNetworkRules: ReadNetworkRules;
  readNetworkRulesDraftChanges: ReadNetworkRulesDraftChanges;
  setBuiltInRule: SetBuiltInRule;
  readBuiltInRules: ReadBuiltInRules;
  readReachRefusals: ReadReachRefusals;
  declareNetworkRules: DeclareNetworkRules;
  readDeclaredNetworkRules: ReadDeclaredNetworkRules;
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
  receiveReply: ReceiveReply;
  pushReceiveDeliveries: PushReceiveDeliveries;
  handOverDelivery: HandOverDelivery;
  reportHandled: ReportHandled;
  readDelivery: ReadDelivery;
  reportNotHandled: ReportNotHandled;
  /** One pass of the 10 and 60 minute clocks; core runs it, never the API. */
  tellOverdueDeliveries: TellOverdueDeliveries;
  closeHealthSnapshots: CloseHealthSnapshots;
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
  sentMessage: ReadSentMessage;
  readShipWay: ReadShipWay;
  readNeedsAttention: ReadNeedsAttention;
  readHealth: ReadHealth;
  readInbox: ReadInbox;
  readInboxMessage: ReadInboxMessage;
  readInboxWithdrawals: ReadInboxWithdrawals;
  countOpenInbox: CountOpenInbox;
  signIn: SignIn;
  signOut: SignOut;
  readAccount: ReadAccount;
  readArgoSignIn: ReadArgoSignIn;
  setTheme: SetTheme;
  setOperatorLogin: SetOperatorLogin;
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
  authenticateAccount: AuthenticateAccount;
  authenticateInstallation: AuthenticateInstallation;
  cutOffAccount: CutOffAccount;
  signOutAccount: SignOutAccount;
  createFleet: CreateFleet;
  deleteFleet: DeleteFleet;
  listInstallationFleets: ListInstallationFleets;
  getInstallationFleet: GetInstallationFleet;
  issueSignInTicket: IssueSignInTicket;
  issueSignInLink: IssueSignInLink;
  redeemSignInTicket: RedeemSignInTicket;
  getInstallationSettings: GetInstallationSettings;
  setInstallationSettings: SetInstallationSettings;
  getFleetLimits: GetFleetLimits;
  readFleetName: ReadFleetName;
  setFleetLimits: SetFleetLimits;
  readFleetLimits: ReadFleetLimits;
}

export const systemClock: Clock = { now: () => new Date() };

/** Where no pagasae signs account tokens, as on a self-hosted server: no account token is trusted. */
const NO_ACCOUNT_TOKEN_SIGNATURES: AccountTokenSignatures = { verify: () => Promise.resolve(undefined) };

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
  /** Wake a waiting follow and an inbox check with a known count; without them both end only at their wait. */
  fleetEventWakeups?: FleetEventWakeups;
  /** How long a receive waits on an empty inbox; about 25 seconds unless a test says otherwise. */
  receiveWaitMs?: number;
  /** pagasae's signatures on account tokens (decision 0058); without them, no account token is trusted. */
  accountTokenSignatures?: AccountTokenSignatures;
}): UseCases {
  const { prisma } = options;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? createIdGenerator();
  const uow = createPrismaUnitOfWork(prisma);
  const readReach = createReadReachOf({ uow });
  // A fleet delete and a retire grow with the fleet's history and the ship's pending deliveries.
  const bulkUow = createPrismaBulkUnitOfWork(prisma);
  const secrets = { hasher: sha256Hasher, random: cryptoRandomTokens };
  const wakeups = options.wakeups ?? createReceiverWakeups();
  const fleetNews = options.fleetEventWakeups ?? fleetEventWakeupsOf(createFleetEventWakeups());
  const notices = createPrismaNoticeRepository(prisma);
  const dismissals = createPrismaNoticeDismissals(prisma);
  const guide = createPrismaGuideRepository(prisma);
  const guideProgress = createPrismaGuideProgress(prisma);
  const accountCutOffs = createPrismaAccountCutOffs(prisma);
  const hostedFleets = createPrismaHostedFleets(prisma);

  return {
    ping: createPing({ clock, fleets: createPrismaFleetCounter(prisma) }),
    initialiseFleet: createInitialiseFleet({ uow, clock, ids }),
    listFleets: createListFleets({ fleets: createPrismaFleetRepository(prisma) }),
    createFleet: createCreateFleet({ uow, clock, ids, hasher: sha256Hasher }),
    deleteFleet: createDeleteFleet({ uow: bulkUow, clock, hasher: sha256Hasher }),
    issueSignInTicket: createIssueSignInTicket({ uow, clock, ids, hasher: sha256Hasher, random: cryptoRandomTokens }),
    issueSignInLink: createIssueSignInLink({ uow, clock, ids, hasher: sha256Hasher, random: cryptoRandomTokens }),
    getInstallationSettings: createGetInstallationSettings({ settings: createPrismaInstallationSettings(prisma) }),
    setInstallationSettings: createSetInstallationSettings({ uow }),
    getFleetLimits: createGetFleetLimits({ uow }),
    readFleetName: createReadFleetName({ uow }),
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
    listInstallationFleets: createListInstallationFleets({
      fleets: createPrismaInstallationFleets(prisma),
      settings: createPrismaInstallationSettings(prisma),
      health: createPrismaHealthRecords(prisma),
      snapshots: createPrismaHealthSnapshots(prisma),
      clock,
    }),
    getInstallationFleet: createGetInstallationFleet({
      fleets: createPrismaInstallationFleets(prisma),
      settings: createPrismaInstallationSettings(prisma),
      health: createPrismaHealthRecords(prisma),
      snapshots: createPrismaHealthSnapshots(prisma),
      clock,
    }),
    commissionShip: createCommissionShip({ uow, clock, ids, secrets }),
    getStartingPrompt: createGetStartingPrompt({ uow, clock, ids, secrets }),
    releaseShip: createReleaseShip({ uow, clock, ids }),
    retireShip: createRetireShip({ uow: bulkUow, clock, ids }),
    renameShip: createRenameShip({ uow, clock, ids }),
    setOwner: createSetOwner({ uow, clock, ids }),
    setVerifiedFacts: createSetVerifiedFacts({ uow, clock, ids }),
    recrewShip: createRecrewShip({ uow, clock, ids, secrets }),
    listFleet: createListFleet({ listing: createPrismaFleetListing(prisma), readReach }),
    getShip: createGetShip({ listing: createPrismaFleetListing(prisma), readReach }),
    readOnBehalf: createReadOnBehalf({ ships: createPrismaShipRepository(prisma) }),
    claimShip: createClaimShip({ uow, clock, ids, secrets }),
    whoami: createWhoami({ ships: createPrismaShipRepository(prisma) }),
    report: createReport({ uow, clock, ids }),
    setStatement: createSetStatement({ uow, clock, ids }),
    discover: createDiscover({ uow }),
    reportTurn: createReportTurn({ uow, clock, ids }),
    requestCrew: createRequestCrew({ uow, clock, ids }),
    removeCrewRequest: createRemoveCrewRequest({ uow, clock, ids }),
    assignCrew: createAssignCrew({ uow, clock, ids }),
    reportCrewStatus: createReportCrewStatus({ uow, clock, ids }),
    confirmCrewRelease: createConfirmCrewRelease({ uow, clock, ids }),
    giveBackCrewRequest: createGiveBackCrewRequest({ uow, clock, ids }),
    readAssignedCrewRequests: createReadAssignedCrewRequests({ crewRequests: createPrismaCrewRequestRepository(prisma), ships: createPrismaShipRepository(prisma) }),
    explainCrewRequest: createExplainCrewRequest({ uow, clock, ids }),
    requestWorktreeClear: createRequestWorktreeClear({ uow, clock, ids }),
    readClearRequests: createReadClearRequests({ clearRequests: createPrismaClearRequestRepository(prisma), readReach }),
    confirmWorktreeCleared: createConfirmWorktreeCleared({ uow, clock, ids }),
    defineLabel: createDefineLabel({ uow, clock, ids }),
    declareScopes: createDeclareScopes({ uow, clock, ids }),
    grantScopes: createGrantScopes({ uow, clock, ids }),
    listScopes: createListScopes({ scopeNamespaces: createPrismaScopeNamespaceRepository(prisma), ships: createPrismaShipRepository(prisma) }),
    saveNetworkRulesDraft: createSaveNetworkRulesDraft({ uow, clock, ids }),
    discardNetworkRulesDraft: createDiscardNetworkRulesDraft({ uow, clock, ids }),
    applyNetworkRules: createApplyNetworkRules({ uow, clock, ids }),
    readNetworkRules: createReadNetworkRules({ uow }),
    readNetworkRulesDraftChanges: createReadNetworkRulesDraftChanges({ uow, readReach }),
    setBuiltInRule: createSetBuiltInRule({ uow, clock, ids }),
    readBuiltInRules: createReadBuiltInRules({ uow }),
    readReachRefusals: createReadReachRefusals({ reachRefusals: createPrismaReachRefusalRepository(prisma), readReach }),
    declareNetworkRules: createDeclareNetworkRules({ uow, clock, ids }),
    readDeclaredNetworkRules: createReadDeclaredNetworkRules({ declaredNetworkRules: createPrismaDeclaredNetworkRulesRepository(prisma) }),
    explainReach: createExplainReach({ uow, readReach }),
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
    receiveReply: createReceiveReply({
      uow,
      clock,
      ids,
      wakeups,
      waitMs: options.receiveWaitMs,
    }),
    pushReceiveDeliveries: createPushReceiveDeliveries({
      uow,
      clock,
      ids,
      wakeups,
      waitMs: options.receiveWaitMs,
    }),
    handOverDelivery: createHandOverDelivery({ uow, clock, ids }),
    reportHandled: createReportHandled({ uow, clock, ids }),
    readDelivery: createReadDelivery({ uow }),
    reportNotHandled: createReportNotHandled({ uow, clock, ids }),
    tellOverdueDeliveries: createTellOverdueDeliveries({ fleets: createPrismaFleetRepository(prisma), pushedCrews: createPrismaPushedCrews(prisma), uow, clock, ids }),
    closeHealthSnapshots: createCloseHealthSnapshots({ fleets: createPrismaFleetRepository(prisma), uow: createPrismaSnapshotUnitOfWork(prisma), clock }),
    acknowledgeDelivery: createAcknowledgeDelivery({ uow, clock, ids }),
    answerPing: createAnswerPing({ uow, clock, ids }),
    pingShip: createPingShip({ uow, clock, ids, hasher: sha256Hasher }),
    checkInbox: createCheckInbox({ uow, clock, wakeups, fleetNews }),
    dismissDelivery: createDismissDelivery({ uow, clock, ids, readReach }),
    resendDelivery: createResendDelivery({ uow, clock, ids, hasher: sha256Hasher, readReach }),
    markRead: createMarkRead({ uow, clock }),
    markDone: createMarkDone({ uow, clock, ids }),
    replyToMessage: createReplyToMessage({ uow, clock, ids, hasher: sha256Hasher }),
    readFleetEvents: createReadFleetEvents({ feed: createPrismaFleetEventFeed(prisma), history: createPrismaShipHistory(prisma), readReach }),
    followFleet: createFollowFleet({
      feed: createPrismaFleetEventFeed(prisma),
      clock,
      history: createPrismaShipHistory(prisma),
      readReach,
      wakeups: fleetNews,
    }),
    readShipTimeline: createReadShipTimeline({ history: createPrismaShipHistory(prisma), readReach }),
    readShipMessages: createReadShipMessages({ history: createPrismaShipHistory(prisma), readReach }),
    readMessage: createReadMessage({ history: createPrismaShipHistory(prisma), readReach }),
    sentMessage: createReadSentMessage({ history: createPrismaShipHistory(prisma) }),
    readShipWay: createReadShipWay({ history: createPrismaShipHistory(prisma), uow, clock, ids }),
    readNeedsAttention: createReadNeedsAttention({ history: createPrismaShipHistory(prisma), readReach }),
    readHealth: createReadHealth({ health: createPrismaHealthRecords(prisma), snapshots: createPrismaHealthSnapshots(prisma), clock, readReach }),
    readInbox: createReadInbox({ history: createPrismaShipHistory(prisma), ships: createPrismaShipRepository(prisma), readReach }),
    readInboxMessage: createReadInboxMessage({ history: createPrismaShipHistory(prisma), ships: createPrismaShipRepository(prisma), readReach }),
    readInboxWithdrawals: createReadInboxWithdrawals({ history: createPrismaShipHistory(prisma), ships: createPrismaShipRepository(prisma), readReach }),
    countOpenInbox: createCountOpenInbox({ history: createPrismaShipHistory(prisma), ships: createPrismaShipRepository(prisma), readReach }),
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
    readArgoSignIn: createReadArgoSignIn({ uow, clock }),
    setTheme: createSetTheme({ uow }),
    // Without pagasae's signatures core trusts no account, and argo's own sign-in is the way in.
    setOperatorLogin: createSetOperatorLogin({ uow, clock, ids, accounts: createPrismaOperatorAccountLookup(prisma), passwords: argon2idPasswordHasher, isSelfHosted: options.accountTokenSignatures === undefined }),
    resetOperatorPassword: createResetOperatorPassword({ uow, clock, ids, passwords: argon2idPasswordHasher }),
    authenticate: createAuthenticate({ callers: createPrismaCallers(prisma), hasher: sha256Hasher, clock }),
    authenticateAccount: createAuthenticateAccount({
      signatures: options.accountTokenSignatures ?? NO_ACCOUNT_TOKEN_SIGNATURES,
      cutOffs: accountCutOffs,
      fleets: hostedFleets,
      clock,
    }),
    authenticateInstallation: createAuthenticateInstallation({ fleets: hostedFleets }),
    cutOffAccount: createCutOffAccount({ cutOffs: accountCutOffs, uow, clock, ids }),
    signOutAccount: createSignOutAccount({ uow, clock, ids }),
  };
}
