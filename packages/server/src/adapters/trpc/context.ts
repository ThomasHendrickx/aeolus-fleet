import type { FleetId } from '@aeolus-fleet/common';

import type { Authenticate } from '../../core/identity/authenticate.js';
import type { ReadAccount } from '../../core/identity/read-account.js';
import type { SetTheme } from '../../core/identity/set-theme.js';
import type { SignIn } from '../../core/identity/sign-in.js';
import type { SignOut } from '../../core/identity/sign-out.js';
import type { AcknowledgeDelivery } from '../../core/messaging/acknowledge-delivery.js';
import type { AnswerPing } from '../../core/messaging/answer-ping.js';
import type { CheckInbox } from '../../core/messaging/check-inbox.js';
import type { DismissDelivery } from '../../core/messaging/dismiss-delivery.js';
import type { MarkDone } from '../../core/messaging/mark-done.js';
import type { MarkRead } from '../../core/messaging/mark-read.js';
import type { ReceiveDeliveries } from '../../core/messaging/receive-deliveries.js';
import type { ReplyToMessage } from '../../core/messaging/reply-to-message.js';
import type { PingShip } from '../../core/messaging/ping-ship.js';
import type { ResendDelivery } from '../../core/messaging/resend-delivery.js';
import type { SendMessage } from '../../core/messaging/send-message.js';
import type { ClaimShip } from '../../core/registry/claim-ship.js';
import type { CommissionShip } from '../../core/registry/commission-ship.js';
import type { Deregister } from '../../core/registry/deregister.js';
import type { GetShip } from '../../core/registry/get-ship.js';
import type { GetStartingPrompt } from '../../core/registry/get-starting-prompt.js';
import type { ListFleet } from '../../core/registry/list-fleet.js';
import type { RecrewShip } from '../../core/registry/recrew-ship.js';
import type { ReleaseShip } from '../../core/registry/release-ship.js';
import type { RenameShip } from '../../core/registry/rename-ship.js';
import type { RetireShip } from '../../core/registry/retire-ship.js';
import type { Report } from '../../core/registry/report.js';
import type { Whoami } from '../../core/registry/whoami.js';
import type { Ping } from '../../core/shared/ping.js';
import type { ReadFleetEvents } from '../../core/shared/read-fleet-events.js';
import type { FollowFleet } from '../../core/shared/follow-fleet.js';
import type { ReadInbox } from '../../core/shared/read-inbox.js';
import type { ReadMessage } from '../../core/shared/read-message.js';
import type { ReadNeedsAttention } from '../../core/shared/read-needs-attention.js';
import type { ReadShipMessages } from '../../core/shared/read-ship-messages.js';
import type { ReadShipTimeline } from '../../core/shared/read-ship-timeline.js';

/** The use cases procedures can call. Wired once at startup. */
export interface UseCases {
  ping: Ping;
  signIn: SignIn;
  signOut: SignOut;
  readAccount: ReadAccount;
  setTheme: SetTheme;
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

export interface Context {
  useCases: UseCases;
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
