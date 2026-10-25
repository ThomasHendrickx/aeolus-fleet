import { FLEET_URL, OPERATOR } from '../../src/testing/fleet.js';
import {
  idSchema,
  type DeliveryId,
  type FleetId,
  type LeaseId,
  type MessageId,
  type NetworkVerb,
  type Scope,
  type ShipId,
} from '@aeolus-fleet/common';

import { createIssueSignInLink } from '../../src/domain/identity/issue-sign-in-link.js';
import { createIssueSignInTicket } from '../../src/domain/identity/issue-sign-in-ticket.js';
import { createDismissNotice } from '../../src/domain/identity/dismiss-notice.js';
import { createGetGuide } from '../../src/domain/identity/get-guide.js';
import { createGetNotices } from '../../src/domain/identity/get-notices.js';
import { createReadGuide } from '../../src/domain/identity/read-guide.js';
import { createReadNotices } from '../../src/domain/identity/read-notices.js';
import { createRecordGuideProgress } from '../../src/domain/identity/record-guide-progress.js';
import { createSetGuide } from '../../src/domain/identity/set-guide.js';
import { createSetNotices } from '../../src/domain/identity/set-notices.js';
import { createRedeemSignInTicket } from '../../src/domain/identity/redeem-sign-in-ticket.js';
import { createAuthenticate } from '../../src/domain/identity/authenticate.js';
import { createAuthenticateAccount } from '../../src/domain/identity/authenticate-account.js';
import { createAuthenticateInstallation } from '../../src/domain/identity/authenticate-installation.js';
import { createCutOffAccount } from '../../src/domain/identity/cut-off-account.js';
import { createSignOutAccount } from '../../src/domain/identity/sign-out-account.js';
import type { AccountCutOffRepository, HostedFleets } from '../../src/domain/identity/ports.js';
import { createReadAccount } from '../../src/domain/identity/read-account.js';
import { createReadArgoSignIn } from '../../src/domain/identity/read-argo-sign-in.js';
import { createSetOperatorLogin } from '../../src/domain/identity/set-operator-login.js';
import { createResetOperatorPassword } from '../../src/domain/identity/reset-operator-password.js';
import { createSignIn } from '../../src/domain/identity/sign-in.js';
import { createSetTheme } from '../../src/domain/identity/set-theme.js';
import { createSignOut } from '../../src/domain/identity/sign-out.js';
import { createAcknowledgeDelivery } from '../../src/domain/messaging/acknowledge-delivery.js';
import { createAnswerPing } from '../../src/domain/messaging/answer-ping.js';
import { createCheckInbox } from '../../src/domain/messaging/check-inbox.js';
import { createMarkDone } from '../../src/domain/messaging/mark-done.js';
import { createMarkRead } from '../../src/domain/messaging/mark-read.js';
import { createHandOverDelivery } from '../../src/domain/messaging/hand-over-delivery.js';
import { createReadDelivery } from '../../src/domain/messaging/read-delivery.js';
import { createReportHandled } from '../../src/domain/messaging/report-handled.js';
import { createReportNotHandled } from '../../src/domain/messaging/report-not-handled.js';
import { createPingShip } from '../../src/domain/messaging/ping-ship.js';
import { createPushReceiveDeliveries } from '../../src/domain/messaging/push-receive-deliveries.js';
import { createReplyToMessage } from '../../src/domain/messaging/reply-to-message.js';
import { createDismissDelivery } from '../../src/domain/messaging/dismiss-delivery.js';
import { createReceiveDeliveries } from '../../src/domain/messaging/receive-deliveries.js';
import { createReceiveReply } from '../../src/domain/messaging/receive-reply.js';
import { createResendDelivery } from '../../src/domain/messaging/resend-delivery.js';
import { createSendMessage } from '../../src/domain/messaging/send-message.js';
import { createOpenMeeting } from '../../src/domain/messaging/open-meeting.js';
import { createReadMeeting } from '../../src/domain/messaging/read-meeting.js';
import { createChangeMic } from '../../src/domain/messaging/change-mic.js';
import { createChangeMeeting } from '../../src/domain/messaging/change-meeting.js';
import { createAddToMeeting } from '../../src/domain/messaging/add-to-meeting.js';
import { createTellOverdueDeliveries } from '../../src/domain/messaging/tell-overdue-deliveries.js';
import { createReadDeclaredNetworkRules } from '../../src/domain/registry/read-declared-network-rules.js';
import { createReadReachRefusals } from '../../src/domain/registry/read-reach-refusals.js';
import { createSaveNetworkRulesDraft } from '../../src/domain/registry/save-network-rules-draft.js';
import { createDiscardNetworkRulesDraft } from '../../src/domain/registry/discard-network-rules-draft.js';
import { createApplyNetworkRules } from '../../src/domain/registry/apply-network-rules.js';
import { createReadNetworkRules } from '../../src/domain/registry/read-network-rules.js';
import { createExportNetworkRules } from '../../src/domain/registry/export-network-rules.js';
import { createCheckNetworkRulesFile } from '../../src/domain/registry/check-network-rules-file.js';
import { createImportNetworkRules } from '../../src/domain/registry/import-network-rules.js';
import { createReadNetworkRulesDraftChanges } from '../../src/domain/registry/read-network-rules-draft-changes.js';
import { createExplainReach } from '../../src/domain/registry/explain-reach.js';
import { createDiscover } from '../../src/domain/registry/discover.js';
import { createSetStatement } from '../../src/domain/registry/set-statement.js';
import { createReadBuiltInRules } from '../../src/domain/registry/read-built-in-rules.js';
import { createSetBuiltInRule } from '../../src/domain/registry/set-built-in-rule.js';
import { createClaimShip } from '../../src/domain/registry/claim-ship.js';
import { createCommissionShip } from '../../src/domain/registry/commission-ship.js';
import { createGiveBackCrewRequest } from '../../src/domain/registry/give-back-crew-request.js';
import { createCreateFleet } from '../../src/domain/registry/create-fleet.js';
import { createDeleteFleet } from '../../src/domain/registry/delete-fleet.js';
import { createGetInstallationFleet } from '../../src/domain/registry/get-installation-fleet.js';
import { createListInstallationFleets } from '../../src/domain/registry/list-installation-fleets.js';
import { createGetFleetLimits } from '../../src/domain/registry/get-fleet-limits.js';
import { createReadFleetName } from '../../src/domain/registry/read-fleet-name.js';
import { createGetInstallationSettings } from '../../src/domain/registry/get-installation-settings.js';
import { createSetFleetLimits } from '../../src/domain/registry/set-fleet-limits.js';
import { createSetInstallationSettings } from '../../src/domain/registry/set-installation-settings.js';
import { createReadFleetLimits } from '../../src/domain/shared/read-fleet-limits.js';
import { createDeregister } from '../../src/domain/registry/deregister.js';
import { createGetShip } from '../../src/domain/registry/get-ship.js';
import { createReadListedShip } from '../../src/domain/registry/read-listed-ship.js';
import { createCountShips } from '../../src/domain/registry/count-ships.js';
import { createListShipTypes } from '../../src/domain/registry/list-ship-types.js';
import { createReadOnBehalf } from '../../src/domain/registry/read-on-behalf.js';
import { createGetStartingPrompt } from '../../src/domain/registry/get-starting-prompt.js';
import { createInitialiseFleet, type FleetInitialised } from '../../src/domain/registry/initialise-fleet.js';
import { createListFleet } from '../../src/domain/registry/list-fleet.js';
import { createReadReachOf } from '../../src/domain/registry/read-reach.js';
import { createRecrewShip } from '../../src/domain/registry/recrew-ship.js';
import { createReleaseShip } from '../../src/domain/registry/release-ship.js';
import { createSetOwner } from '../../src/domain/registry/set-owner.js';
import { createRenameShip } from '../../src/domain/registry/rename-ship.js';
import { createSetVerifiedFacts } from '../../src/domain/registry/set-verified-facts.js';
import { createRetireShip } from '../../src/domain/registry/retire-ship.js';
import { createReport } from '../../src/domain/registry/report.js';
import { createReportTurn } from '../../src/domain/registry/report-turn.js';
import { createRequestCrew } from '../../src/domain/registry/request-crew.js';
import { createDeclareNetworkRules } from '../../src/domain/registry/declare-network-rules.js';
import { createDeclareScopes } from '../../src/domain/registry/declare-scopes.js';
import { createGrantScopes } from '../../src/domain/registry/grant-scopes.js';
import { createListScopes } from '../../src/domain/registry/list-scopes.js';
import { createDefineLabel } from '../../src/domain/registry/define-label.js';
import { createDeleteLabel } from '../../src/domain/registry/delete-label.js';
import { createFindLabelValue } from '../../src/domain/registry/find-label-value.js';
import { createChangeLabelValues } from '../../src/domain/registry/change-label-values.js';
import { createAssignLabel } from '../../src/domain/registry/assign-label.js';
import { createUnassignLabel } from '../../src/domain/registry/unassign-label.js';
import { createListLabels } from '../../src/domain/registry/list-labels.js';
import { createRemoveCrewRequest } from '../../src/domain/registry/remove-crew-request.js';
import { createAssignCrew } from '../../src/domain/registry/assign-crew.js';
import { createReportCrewStatus } from '../../src/domain/registry/report-crew-status.js';
import { createConfirmWorktreeCleared } from '../../src/domain/registry/confirm-worktree-cleared.js';
import { createReadClearRequests } from '../../src/domain/registry/read-clear-requests.js';
import { createRequestWorktreeClear } from '../../src/domain/registry/request-worktree-clear.js';
import { createConfirmCrewRelease } from '../../src/domain/registry/confirm-crew-release.js';
import { createReadAssignedCrewRequests } from '../../src/domain/registry/read-assigned-crew-requests.js';
import { createExplainCrewRequest } from '../../src/domain/registry/explain-crew-request.js';
import { createReadReportLog } from '../../src/domain/registry/report-log.js';
import { createWhoami } from '../../src/domain/registry/whoami.js';
import type { NetworkRule } from '../../src/domain/registry/network-settings.js';
import { isCrew, type Caller, type ShipCaller, type Crew } from '../../src/domain/shared/caller.js';
import { createReadFleetEvents } from '../../src/domain/shared/read-fleet-events.js';
import { createFollowFleet } from '../../src/domain/shared/follow-fleet.js';
import { createReadInbox } from '../../src/domain/shared/read-inbox.js';
import { createReadInboxMessage } from '../../src/domain/shared/read-inbox-message.js';
import { createReadInboxWithdrawals } from '../../src/domain/shared/read-inbox-withdrawals.js';
import { createCountOpenInbox } from '../../src/domain/shared/count-open-inbox.js';
import { createReadMessage } from '../../src/domain/shared/read-message.js';
import { createReadSentMessage } from '../../src/domain/shared/read-sent-message.js';
import { createReadShipWay } from '../../src/domain/shared/read-ship-way.js';
import { createReadNeedsAttention } from '../../src/domain/shared/read-needs-attention.js';
import { createReadAcknowledged } from '../../src/domain/shared/read-acknowledged.js';
import { createReadHealth } from '../../src/domain/shared/read-health.js';
import { createReadStuckCount } from '../../src/domain/shared/read-stuck-count.js';
import { createReadStuckHistory } from '../../src/domain/shared/read-stuck-history.js';
import { createReadStuckSummary } from '../../src/domain/shared/read-stuck-summary.js';
import { createReadStuck } from '../../src/domain/shared/read-stuck.js';
import { createReadShipMessages } from '../../src/domain/shared/read-ship-messages.js';
import { createReadShipTimeline } from '../../src/domain/shared/read-ship-timeline.js';
import type { Recipient } from '../../src/domain/shared/selector.js';
import type { InMemoryCore } from './in-memory.js';
import { unwrap } from '../../src/testing/result.js';

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
  // No pagasae signs here, and no cut-off is kept: the account-token tests wire their own.
  const cutOffs: AccountCutOffRepository = { record: () => Promise.resolve(), cutOffAt: () => Promise.resolve(undefined), forget: () => Promise.resolve() };
  const fleets: HostedFleets = { isHosted: (fleetId) => Promise.resolve(core.state.fleets.some((fleet) => fleet.id === fleetId)) };
  return {
    authenticateAccount: createAuthenticateAccount({ signatures: { verify: () => Promise.resolve(undefined) }, cutOffs, fleets, clock: core.clock }),
    authenticateInstallation: createAuthenticateInstallation({ fleets }),
    cutOffAccount: createCutOffAccount({ cutOffs, uow: core.uow, clock: core.clock, ids: core.ids }),
    signOutAccount: createSignOutAccount({ uow: core.uow, clock: core.clock, ids: core.ids }),
    signIn: createSignIn(deps),
    signOut: createSignOut(deps),
    resetOperatorPassword: createResetOperatorPassword(deps),
    // No pagasae here: argo's own sign-in is the way in.
    setOperatorLogin: createSetOperatorLogin({ ...deps, isSelfHosted: true }),
    readAccount: createReadAccount(deps),
    readArgoSignIn: createReadArgoSignIn(deps),
    setTheme: createSetTheme(deps),
    authenticate: createAuthenticate({ callers: core.callers, hasher: core.hasher, clock: core.clock }),
    issueSignInTicket: createIssueSignInTicket(deps),
    issueSignInLink: createIssueSignInLink(deps),
    redeemSignInTicket: createRedeemSignInTicket(deps),
    setNotices: createSetNotices({ notices: core.notices }),
    getNotices: createGetNotices({ notices: core.notices }),
    readNotices: createReadNotices({ notices: core.notices, dismissals: core.noticeDismissals }),
    dismissNotice: createDismissNotice({ notices: core.notices, dismissals: core.noticeDismissals, clock: core.clock }),
    setGuide: createSetGuide({ guide: core.guide }),
    getGuide: createGetGuide({ guide: core.guide }),
    readGuide: createReadGuide({ guide: core.guide, progress: core.guideProgress }),
    recordGuideProgress: createRecordGuideProgress({ guide: core.guide, progress: core.guideProgress, clock: core.clock }),
  };
}


/** The fleet's MCP URL, which starting prompts carry in tests: /mcp under the public URL. */
export const FLEET_MCP_URL = `${FLEET_URL}/mcp`;

/**
 * The operator signed in to the console: argo's crew, under the lease its
 * console session holds, as the session cookie makes it the caller.
 */
export async function argoAboard(core: InMemoryCore): Promise<Crew> {
  const identity = identityUseCases(core);
  const { token } = unwrap(await identity.signIn(OPERATOR));
  const use = await identity.authenticate.byConsoleSession(token);
  if (!use || !isCrew(use.caller)) {
    throw new Error('The console session the sign-in started does not authenticate as the crew of argo');
  }
  return use.caller;
}

/**
 * Applies the rules as an editor does (decision 0034): saves them as the
 * fleet's draft, then applies it at the version it was saved against. None
 * is all-to-all. Answers the version the settings have then.
 */
export async function applyNetworkRules(
  registry: Pick<ReturnType<typeof registryUseCases>, 'saveNetworkRulesDraft' | 'applyNetworkRules'>,
  apply: { by: Caller; rules: readonly NetworkRule[] | null },
): Promise<number> {
  const { savedAgainstVersion } = unwrap(await registry.saveNetworkRulesDraft(apply.by, { rules: apply.rules }));
  return unwrap(await registry.applyNetworkRules(apply.by, { version: savedAgainstVersion })).version;
}

/** A rule that lets every actor do the verb to every ship, as open does while no rules are applied. */
export function everyShipMay(verb: NetworkVerb): NetworkRule {
  return { verb, from: [], to: [] };
}

/** The registry use cases, wired to the in-memory core: the operator's, and the claim and deregister a session makes. */
export function registryUseCases(core: InMemoryCore) {
  const deps = {
    uow: core.uow,
    clock: core.clock,
    ids: core.ids,
    secrets: { hasher: core.hasher, random: core.random },
  };
  return {
    commissionShip: createCommissionShip(deps),
    getStartingPrompt: createGetStartingPrompt(deps),
    releaseShip: createReleaseShip(deps),
    retireShip: createRetireShip({ ...deps, hasher: core.hasher }),
    requestCrew: createRequestCrew(deps),
    removeCrewRequest: createRemoveCrewRequest(deps),
    assignCrew: createAssignCrew(deps),
    reportCrewStatus: createReportCrewStatus(deps),
    confirmCrewRelease: createConfirmCrewRelease(deps),
    giveBackCrewRequest: createGiveBackCrewRequest(deps),
    readAssignedCrewRequests: createReadAssignedCrewRequests({ crewRequests: core.crewRequests, ships: core.ships }),
    explainCrewRequest: createExplainCrewRequest(deps),
    requestWorktreeClear: createRequestWorktreeClear(deps),
    readClearRequests: createReadClearRequests({ clearRequests: core.clearRequests, readReach: readReachOf(core) }),
    confirmWorktreeCleared: createConfirmWorktreeCleared(deps),
    defineLabel: createDefineLabel(deps),
    declareScopes: createDeclareScopes(deps),
    grantScopes: createGrantScopes(deps),
    listScopes: createListScopes({ scopeNamespaces: core.scopeNamespaces, ships: core.ships }),
    saveNetworkRulesDraft: createSaveNetworkRulesDraft(deps),
    discardNetworkRulesDraft: createDiscardNetworkRulesDraft(deps),
    applyNetworkRules: createApplyNetworkRules(deps),
    readNetworkRules: createReadNetworkRules(deps),
    exportNetworkRules: createExportNetworkRules(deps),
    checkNetworkRulesFile: createCheckNetworkRulesFile(deps),
    importNetworkRules: createImportNetworkRules(deps),
    readNetworkRulesDraftChanges: createReadNetworkRulesDraftChanges({ ...deps, readReach: readReachOf(core) }),
    setBuiltInRule: createSetBuiltInRule(deps),
    readBuiltInRules: createReadBuiltInRules(deps),
    readReachRefusals: createReadReachRefusals({ reachRefusals: core.reachRefusals, readReach: readReachOf(core) }),
    declareNetworkRules: createDeclareNetworkRules({ uow: core.uow, clock: core.clock, ids: core.ids }),
    readDeclaredNetworkRules: createReadDeclaredNetworkRules({ declaredNetworkRules: core.declaredNetworkRules }),
    explainReach: createExplainReach({ ...deps, readReach: readReachOf(core) }),
    changeLabelValues: createChangeLabelValues(deps),
    assignLabel: createAssignLabel(deps),
    unassignLabel: createUnassignLabel(deps),
    deleteLabel: createDeleteLabel(deps),
    listLabels: createListLabels({ listing: core.listing, readReach: readReachOf(core) }),
    findLabelValue: createFindLabelValue({ listing: core.listing }),
    renameShip: createRenameShip(deps),
    setOwner: createSetOwner(deps),
    setVerifiedFacts: createSetVerifiedFacts(deps),
    recrewShip: createRecrewShip(deps),
    claimShip: createClaimShip(deps),
    deregister: createDeregister(deps),
    createFleet: createCreateFleet({ ...deps, hasher: core.hasher }),
    deleteFleet: createDeleteFleet({ ...deps, hasher: core.hasher }),
    listInstallationFleets: createListInstallationFleets({ fleets: core.installationFleets, settings: core.installationSettings, health: core.health, snapshots: core.healthSnapshots, clock: core.clock }),
    getInstallationSettings: createGetInstallationSettings({ settings: core.installationSettings }),
    setInstallationSettings: createSetInstallationSettings({ uow: core.uow }),
    getFleetLimits: createGetFleetLimits({ uow: core.uow }),
    readFleetName: createReadFleetName({ uow: core.uow }),
    setFleetLimits: createSetFleetLimits({ uow: core.uow, clock: core.clock, ids: core.ids }),
    readFleetLimits: createReadFleetLimits({ limits: core.fleetLimitReads, clock: core.clock }),
    getInstallationFleet: createGetInstallationFleet({ fleets: core.installationFleets, settings: core.installationSettings, health: core.health, snapshots: core.healthSnapshots, clock: core.clock }),
    listFleet: createListFleet({ listing: core.listing, readReach: readReachOf(core) }),
    getShip: createGetShip({ listing: core.listing, readReach: readReachOf(core) }),
    readListedShip: createReadListedShip({ listing: core.listing, readReach: readReachOf(core) }),
    countShips: createCountShips({ listing: core.listing, readReach: readReachOf(core) }),
    listShipTypes: createListShipTypes({ listing: core.listing, readReach: readReachOf(core) }),
    readOnBehalf: createReadOnBehalf({ ships: core.ships }),
    whoami: createWhoami({ ships: core.ships }),
    report: createReport({ uow: core.uow, clock: core.clock, ids: core.ids }),
    setStatement: createSetStatement({ uow: core.uow, clock: core.clock, ids: core.ids }),
    discover: createDiscover({ uow: core.uow }),
    reportTurn: createReportTurn({ uow: core.uow, clock: core.clock, ids: core.ids }),
    reportLog: createReadReportLog({ leases: core.leases }),
    readFleetEvents: createReadFleetEvents({ feed: core.feed, history: core.history, readReach: readReachOf(core) }),
    // Nothing wakes a follow here: it ends at its wait.
    followFleet: createFollowFleet({
      feed: core.feed,
      clock: core.clock,
      wakeups: { watch: () => ({ next: () => Promise.resolve('timedOut'), stop: () => undefined }) },
      history: core.history,
      readReach: readReachOf(core),
    }),
  };
}

/** What a caller reads (decision 0034), worked out from the in-memory core. */
export function readReachOf(core: InMemoryCore) {
  return createReadReachOf({ uow: core.uow });
}

/** The history reads for the ship page, wired to the in-memory core. */
export function historyUseCases(core: InMemoryCore) {
  const readReach = readReachOf(core);
  return {
    readShipTimeline: createReadShipTimeline({ history: core.history, readReach }),
    readShipMessages: createReadShipMessages({ history: core.history, readReach }),
    readMessage: createReadMessage({ history: core.history, readReach }),
    sentMessage: createReadSentMessage({ history: core.history }),
    readShipWay: createReadShipWay({ history: core.history, uow: core.uow, clock: core.clock, ids: core.ids }),
    readNeedsAttention: createReadNeedsAttention({ history: core.history, readReach }),
    readHealth: createReadHealth({ health: core.health, snapshots: core.healthSnapshots, clock: core.clock, readReach }),
    readStuckCount: createReadStuckCount({ health: core.health, snapshots: core.healthSnapshots, clock: core.clock, readReach }),
    readStuck: createReadStuck({ health: core.health, snapshots: core.healthSnapshots, clock: core.clock, readReach }),
    readStuckSummary: createReadStuckSummary({ health: core.health, snapshots: core.healthSnapshots, clock: core.clock, readReach }),
    readStuckHistory: createReadStuckHistory({ health: core.health, snapshots: core.healthSnapshots, clock: core.clock, readReach }),
    readAcknowledged: createReadAcknowledged({ health: core.health, snapshots: core.healthSnapshots, clock: core.clock, readReach }),
    readInbox: createReadInbox({ history: core.history, ships: core.ships, readReach }),
    readInboxMessage: createReadInboxMessage({ history: core.history, ships: core.ships, readReach }),
    readInboxWithdrawals: createReadInboxWithdrawals({ history: core.history, ships: core.ships, readReach }),
    countOpenInbox: createCountOpenInbox({ history: core.history, ships: core.ships, readReach }),
  };
}

/** The messaging use cases, wired to the in-memory core; a receive waits on its scripted wake-ups. */
export function messagingUseCases(core: InMemoryCore) {
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids };
  return {
    sendMessage: createSendMessage({ ...deps, hasher: core.hasher }),
    openMeeting: createOpenMeeting({ ...deps, hasher: core.hasher }),
    readMeeting: createReadMeeting({ uow: core.uow }),
    changeMic: createChangeMic({ ...deps, hasher: core.hasher }),
    changeMeeting: createChangeMeeting({ ...deps, hasher: core.hasher }),
    addToMeeting: createAddToMeeting({ ...deps, hasher: core.hasher }),
    receiveDeliveries: createReceiveDeliveries({ ...deps, wakeups: core.wakeups }),
    receiveReply: createReceiveReply({ ...deps, wakeups: core.wakeups }),
    pushReceiveDeliveries: createPushReceiveDeliveries({ ...deps, wakeups: core.wakeups }),
    handOverDelivery: createHandOverDelivery(deps),
    reportHandled: createReportHandled(deps),
    readDelivery: createReadDelivery(deps),
    reportNotHandled: createReportNotHandled(deps),
    acknowledgeDelivery: createAcknowledgeDelivery(deps),
    checkInbox: createCheckInbox({ ...deps, wakeups: core.wakeups, fleetNews: core.fleetNews }),
    dismissDelivery: createDismissDelivery({ ...deps, readReach: readReachOf(core) }),
    markDone: createMarkDone(deps),
    markRead: createMarkRead(deps),
    replyToMessage: createReplyToMessage({ ...deps, hasher: core.hasher }),
    resendDelivery: createResendDelivery({ ...deps, hasher: core.hasher, readReach: readReachOf(core) }),
    pingShip: createPingShip({ ...deps, hasher: core.hasher }),
    answerPing: createAnswerPing(deps),
    tellOverdueDeliveries: createTellOverdueDeliveries({ ...deps, fleets: core.fleets, pushedCrews: core.pushedCrews }),
  };
}

/** An agent ship as the caller, holding the scopes commissioning gives it, as its crew token makes it. */
export function agentCaller(ship: { fleetId: FleetId; shipId: ShipId }): ShipCaller {
  return { ...ship, kind: 'agent', scopes: ['messages:send', 'messages:receive'] };
}

/** The id of the fleet's argo, which owns every ship the fixtures add (decision 0045). */
export function argoIdOf(core: InMemoryCore, fleetId: FleetId): ShipId {
  const argo = core.state.ships.find((ship) => ship.fleetId === fleetId && ship.kind === 'operator');
  if (!argo) {
    throw new Error(`Fleet ${fleetId} has no argo`);
  }
  return argo.id;
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
export function secretIn(prompt: string | null): string {
  const secret = /^Ship secret: (\S+)$/m.exec(prompt ?? '')?.[1];
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


/**
 * Initialises a fleet named `test fleet` through the use case, so argo and the
 * operator account exist, and gives argo's own sign-in the email and password
 * the tests sign in with, as Settings would set them.
 */
export async function initialiseFleet(core: InMemoryCore, name = 'test fleet'): Promise<FleetInitialised> {
  const initialised = unwrap(await createInitialiseFleet({ uow: core.uow, clock: core.clock, ids: core.ids })({ name }));
  const account = core.state.operatorAccounts.find((held) => held.id === initialised.operatorId);
  if (!account) {
    throw new Error('the fleet was initialised without its operator account');
  }
  account.email = OPERATOR.email;
  account.passwordHash = await core.passwords.hash(OPERATOR.password);
  return initialised;
}

/** Sets the installation's settings straight into the state: unset ones stay no limit. */
export function withInstallationSettings(
  core: InMemoryCore,
  settings: Partial<{ defaultShipLimit: number | null; defaultDailyMessageLimit: number | null; fleetCap: number | null }>,
): void {
  core.state.installationSettings.splice(0, core.state.installationSettings.length, {
    defaultShipLimit: null,
    defaultDailyMessageLimit: null,
    fleetCap: null,
    ...settings,
  });
}

/** A fleet a hosting installation created, through the use case: its argo and an operator without a password. */
export async function hostedFleet(core: InMemoryCore, operatorEmail = 'lena@example.com'): Promise<{ fleetId: FleetId; operatorShipId: ShipId }> {
  const created = await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher })({
    requestId: `signup-${operatorEmail}`,
    name: 'hemma',
    operatorEmail,
  });
  return unwrap(created);
}

/** A fleet the installation created with its viewer ship (decision 0022), answering the fleet, argo and the viewer ship. */
export async function hostedFleetWithViewer(core: InMemoryCore): Promise<{ fleetId: FleetId; operatorShipId: ShipId; viewerShipId: ShipId }> {
  const created = unwrap(
    await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher })({
      requestId: 'signup-with-viewer',
      name: 'demo',
      operatorEmail: 'demo@example.com',
      hasViewer: true,
    }),
  );
  const viewer = core.state.ships.find((ship) => ship.fleetId === created.fleetId && ship.kind === 'viewer');
  if (!viewer) {
    throw new Error('the fleet was created without its viewer ship');
  }
  return { ...created, viewerShipId: viewer.id };
}

/**
 * Puts an agent ship with a valid secret straight into the state, without
 * commissioning it: for a ship with other scopes, in another fleet or already
 * retired, which commissioning never makes.
 */
/** Adds the fleet's viewer ship straight to the in-memory state, as an installation's create with a viewer would. */
export function addViewerShip(core: InMemoryCore, ship: { fleetId: FleetId }): { shipId: ShipId } {
  const shipId = core.ids('ship');
  core.state.ships.push({ id: shipId, fleetId: ship.fleetId, name: 'viewer', type: 'viewer', kind: 'viewer', scopes: ['fleet:read'], note: null, createdAt: core.clock.now(), retiredAt: null, commission: null, owner: null });
  return { shipId };
}

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
    commission: null,
    // argo's, as the owners migration made every ship from before owners (decision 0045).
    owner: core.state.ships.find((held) => held.fleetId === fleetId && held.kind === 'operator')?.id ?? null,
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
    harness: 'claude-code',
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
/** Crews the ship with a session in the harness given, Claude Code unless named. */
export function crewShip(core: InMemoryCore, { harness = 'claude-code', ...ship }: { fleetId: FleetId; shipId: ShipId; harness?: string }): string {
  const crewToken = `aeolus_ct_v1_crew-${ship.shipId}`;
  core.state.leases.push({
    id: core.ids('lease'),
    ...ship,
    location: { kind: 'DEVICE', description: null },
    harness,
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
    model: null,
    idempotencyKey: `in-flight-${messageId}`,
    requestHash: `sha256(in-flight-${messageId})`,
    inReplyToMessageId: null,
    resendOfMessageId: null,
    meetingId: null,
    scheduleId: null,
    sendTime: null,
    createdAt: at,
  });
  core.state.deliveries.push({
    id: deliveryId,
    fleetId,
    messageId,
    recipient,
    state: 'handed',
    claimedByShipId: shipId,
    claimedByLeaseId: leaseId,
    attempts,
    handOverNumber: null,
    handedOnceMoreAt: null,
    isForced: false,
    createdAt: at,
  });
  return { deliveryId, messageId };
}

/** The model a test session states on its sends: every ship but argo states one. */
export const SESSION_MODEL = 'claude-opus-5-5';

/** The model field a send from the caller carries: none from argo, the session's model from any other ship. */
export function modelOf(caller: { kind: string }): { model?: string } {
  return caller.kind === 'operator' ? {} : { model: SESSION_MODEL };
}

export { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../../src/testing/fleet.js';
