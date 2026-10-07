import type { FleetId } from '@aeolus-fleet/common';

import type { Authenticate } from '../../domain/identity/authenticate.js';
import type { ReadAccount } from '../../domain/identity/read-account.js';
import type { SetTheme } from '../../domain/identity/set-theme.js';
import type { SignIn } from '../../domain/identity/sign-in.js';
import type { SignOut } from '../../domain/identity/sign-out.js';
import type { AcknowledgeDelivery } from '../../domain/messaging/acknowledge-delivery.js';
import type { AnswerPing } from '../../domain/messaging/answer-ping.js';
import type { CheckInbox } from '../../domain/messaging/check-inbox.js';
import type { DismissDelivery } from '../../domain/messaging/dismiss-delivery.js';
import type { MarkDone } from '../../domain/messaging/mark-done.js';
import type { MarkRead } from '../../domain/messaging/mark-read.js';
import type { ReceiveDeliveries } from '../../domain/messaging/receive-deliveries.js';
import type { ReplyToMessage } from '../../domain/messaging/reply-to-message.js';
import type { PingShip } from '../../domain/messaging/ping-ship.js';
import type { ResendDelivery } from '../../domain/messaging/resend-delivery.js';
import type { SendMessage } from '../../domain/messaging/send-message.js';
import type { ClaimShip } from '../../domain/registry/claim-ship.js';
import type { IssueSignInTicket } from '../../domain/identity/issue-sign-in-ticket.js';
import type { RedeemSignInTicket } from '../../domain/identity/redeem-sign-in-ticket.js';
import type { GetFleetLimits } from '../../domain/registry/get-fleet-limits.js';
import type { DismissNotice } from '../../domain/identity/dismiss-notice.js';
import type { GetGuide } from '../../domain/identity/get-guide.js';
import type { GetNotices } from '../../domain/identity/get-notices.js';
import type { ReadGuide } from '../../domain/identity/read-guide.js';
import type { ReadNotices } from '../../domain/identity/read-notices.js';
import type { RecordGuideProgress } from '../../domain/identity/record-guide-progress.js';
import type { SetGuide } from '../../domain/identity/set-guide.js';
import type { SetNotices } from '../../domain/identity/set-notices.js';
import type { GetInstallationSettings } from '../../domain/registry/get-installation-settings.js';
import type { SetFleetLimits } from '../../domain/registry/set-fleet-limits.js';
import type { SetInstallationSettings } from '../../domain/registry/set-installation-settings.js';
import type { ReadFleetLimits } from '../../domain/shared/read-fleet-limits.js';
import type { CommissionShip } from '../../domain/registry/commission-ship.js';
import type { CreateFleet } from '../../domain/registry/create-fleet.js';
import type { DeleteFleet } from '../../domain/registry/delete-fleet.js';
import type { GetInstallationFleet } from '../../domain/registry/get-installation-fleet.js';
import type { ListInstallationFleets } from '../../domain/registry/list-installation-fleets.js';
import type { Deregister } from '../../domain/registry/deregister.js';
import type { GetShip } from '../../domain/registry/get-ship.js';
import type { GetStartingPrompt } from '../../domain/registry/get-starting-prompt.js';
import type { ListFleet } from '../../domain/registry/list-fleet.js';
import type { RecrewShip } from '../../domain/registry/recrew-ship.js';
import type { ReleaseShip } from '../../domain/registry/release-ship.js';
import type { RenameShip } from '../../domain/registry/rename-ship.js';
import type { RetireShip } from '../../domain/registry/retire-ship.js';
import type { Report } from '../../domain/registry/report.js';
import type { Whoami } from '../../domain/registry/whoami.js';
import type { ReadReportLog } from '../../domain/registry/report-log.js';
import type { RequestCrew } from '../../domain/registry/request-crew.js';
import type { RemoveCrewRequest } from '../../domain/registry/remove-crew-request.js';
import type { AssignCrew } from '../../domain/registry/assign-crew.js';
import type { ReportCrewStatus } from '../../domain/registry/report-crew-status.js';
import type { ConfirmCrewRelease } from '../../domain/registry/confirm-crew-release.js';
import type { ReadAssignedCrewRequests } from '../../domain/registry/read-assigned-crew-requests.js';
import type { ExplainCrewRequest } from '../../domain/registry/explain-crew-request.js';
import type { Ping } from '../../domain/shared/ping.js';
import type { ReadFleetEvents } from '../../domain/shared/read-fleet-events.js';
import type { AssignLabel } from '../../domain/registry/assign-label.js';
import type { ChangeLabelValues } from '../../domain/registry/change-label-values.js';
import type { DefineLabel } from '../../domain/registry/define-label.js';
import type { ListLabels } from '../../domain/registry/list-labels.js';
import type { UnassignLabel } from '../../domain/registry/unassign-label.js';
import type { FollowFleet } from '../../domain/shared/follow-fleet.js';
import type { ReadInbox } from '../../domain/shared/read-inbox.js';
import type { ReadMessage } from '../../domain/shared/read-message.js';
import type { ReadNeedsAttention } from '../../domain/shared/read-needs-attention.js';
import type { ReadShipMessages } from '../../domain/shared/read-ship-messages.js';
import type { ReadShipTimeline } from '../../domain/shared/read-ship-timeline.js';

/** The use cases procedures can call. Wired once at startup. */
export interface UseCases {
  ping: Ping;
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
  authenticate: Authenticate;
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
  reportLog: ReadReportLog;
  requestCrew: RequestCrew;
  removeCrewRequest: RemoveCrewRequest;
  assignCrew: AssignCrew;
  reportCrewStatus: ReportCrewStatus;
  confirmCrewRelease: ConfirmCrewRelease;
  readAssignedCrewRequests: ReadAssignedCrewRequests;
  explainCrewRequest: ExplainCrewRequest;
  defineLabel: DefineLabel;
  changeLabelValues: ChangeLabelValues;
  assignLabel: AssignLabel;
  unassignLabel: UnassignLabel;
  listLabels: ListLabels;
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

/** What the request carried to say who it is. Neither is trusted until a use case checks it. */
export interface RequestCredentials {
  /** A crew token from `Authorization: Bearer`. */
  bearer?: string;
  /** A console session token from the session cookie. */
  sessionToken?: string;
}

/** Writes the console session cookie on the response. */
export interface SessionCookie {
  set(token: string, expiresAt: Date): void;
  clear(): void;
}

/** Wakes a live subscription when its fleet has committed events. */
export interface FleetEventWatches {
  watch(fleetId: FleetId): {
    /** True when woken; false when the subscription ended or the server stops. */
    next(signal: AbortSignal): Promise<boolean>;
    stop(): void;
  };
}

/**
 * The installation token (docs/architecture.md, "Installation"): the one the
 * server is configured with, none when the installation procedures are off,
 * and the one the request presented in x-aeolus-installation-token.
 */
export interface InstallationCredential {
  configured: string | undefined;
  presented: string | undefined;
}

/** Where a procedure writes what the server must keep a record of, such as a deleted fleet. */
export interface ProcedureLog {
  info(details: Record<string, unknown>, message: string): void;
}

export interface Context {
  useCases: UseCases;
  installation: InstallationCredential;
  log: ProcedureLog;
  /** Where ships reach the fleet, the public URL: what starting prompts and crew lines carry. */
  fleetUrl: string;
  fleetEvents: FleetEventWatches;
  credentials: RequestCredentials;
  /**
   * Whether the door takes the console session: `/trpc` does. The doors for
   * ships (REST, MCP) take the crew token alone, so a refusal there names only
   * the crew token; a ship has no console to sign in to.
   */
  canUseConsoleSession: boolean;
  sessionCookie: SessionCookie;
  /** The User-Agent header the request carried, if any: what a console sign-in names its device by. */
  userAgent: string | undefined;
  /** The Origin header the request carried, if any. A browser sends one with every POST. */
  origin: string | undefined;
  /** The console's origin: the only one state-changing console calls may come from. */
  consoleOrigin: string;
  /** Who is asking, for rate limits: the client address. */
  clientKey: string;
  /** This request's own id: a server failure answers with it, and its log line carries it. */
  requestId: string;
  /** Counts sign-in attempts per client; false when over the limit. */
  takeSignInAttempt: (clientKey: string) => boolean;
  /** When a client over the sign-in limit may try again. */
  signInRetryAt: (clientKey: string) => Date;
  /**
   * Failed register attempts per client, apart from sign-in attempts: only a
   * wrong ship id or secret counts, never a successful claim (ADR 0015).
   */
  registerFailures: {
    hasRoom(clientKey: string): boolean;
    count(clientKey: string): void;
  };
}
