import {
  turnOnSealingInputSchema,
  changeCompanyKeyInputSchema,
  changeCompanyKeyOutputSchema,
  changeRecoveryKeyInputSchema,
  changeRecoveryKeyOutputSchema,
  recoverySetOutputSchema,
  recoverKeysInputSchema,
  recoverKeysOutputSchema,
  turnOnSealingOutputSchema,
  sealingOutputSchema,
  cancelScheduleInputSchema,
  cancelScheduleOutputSchema,
  pauseScheduleInputSchema,
  pauseScheduleOutputSchema,
  fleetSchedulesInputSchema,
  schedulesOutputSchema,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  shipCursorOf,
  commissionShipInputSchema,
  commissionShipOutputSchema,
  dismissDeliveryInputSchema,
  dismissDeliveryOutputSchema,
  fleetEventsInputSchema,
  followFleetInputSchema,
  followFleetOutputSchema,
  inboxActionOutputSchema,
  markDoneInputSchema,
  markReadInputSchema,
  fleetLimitsOutputSchema,
  fleetListOutputSchema,
  messageDeliveriesInputSchema,
  messageDeliveriesOutputSchema,
  messageInputSchema,
  messageOutputSchema,
  needsAttentionInputSchema,
  needsAttentionOutputSchema,
  fleetHealthOutputSchema,
  acknowledgedSchema,
  listedShipOutputSchema,
  shipCountsInputSchema,
  shipTypesInputSchema,
  shipTypesOutputSchema,
  shipCountsOutputSchema,
  stuckCountOutputSchema,
  stuckInputSchema,
  stuckOutputSchema,
  stuckSummaryOutputSchema,
  stuckPerHourSchema,
  operatorInboxInputSchema,
  inboxMessageInputSchema,
  inboxMessageSchema,
  inboxWithdrawalsInputSchema,
  operatorInboxOutputSchema,
  inboxCountOutputSchema,
  pingShipInputSchema,
  pingShipOutputSchema,
  shipOutputSchema,
  isInReadReach,
  shipInputSchema,
  shipMessagesInputSchema,
  shipMessagesOutputSchema,
  shipWayOutputSchema,
  shipTimelineInputSchema,
  shipTimelineOutputSchema,
  type FleetStreamItem,
  getStartingPromptInputSchema,
  recrewShipInputSchema,
  releaseShipInputSchema,
  releaseShipOutputSchema,
  assignCrewInputSchema,
  assignCrewOutputSchema,
  assignedCrewRequestsOutputSchema,
  clearRequestsOutputSchema,
  clearWorktreeInputSchema,
  clearWorktreeOutputSchema,
  confirmWorktreeClearedInputSchema,
  confirmWorktreeClearedOutputSchema,
  confirmCrewReleaseInputSchema,
  giveBackCrewRequestInputSchema,
  giveBackCrewRequestOutputSchema,
  explainCrewRequestInputSchema,
  explainCrewRequestOutputSchema,
  confirmCrewReleaseOutputSchema,
  crewRequestInputSchema,
  crewRequestOutputSchema,
  reportCrewStatusInputSchema,
  reportCrewStatusOutputSchema,
  removeCrewRequestInputSchema,
  removeCrewRequestOutputSchema,
  renameShipInputSchema,
  renameShipOutputSchema,
  replyInputSchema,
  replyOutputSchema,
  resendDeliveryInputSchema,
  resendDeliveryOutputSchema,
  retireShipInputSchema,
  retireShipOutputSchema,
  startingPromptOutputSchema,
  assignLabelInputSchema,
  changeLabelValuesInputSchema,
  changeLabelValuesOutputSchema,
  declareScopesInputSchema,
  defineScopeInputSchema,
  definedScopeOutputSchema,
  removeScopeInputSchema,
  removeScopeOutputSchema,
  declareScopesOutputSchema,
  grantScopesInputSchema,
  grantScopesOutputSchema,
  defineLabelInputSchema,
  defineLabelOutputSchema,
  deleteLabelInputSchema,
  findLabelValueInputSchema,
  reachRefusalsInputSchema,
  reachRefusalsOutputSchema,
  explainReachInputSchema,
  setOwnerInputSchema,
  checkManageInputSchema,
  checkManageOutputSchema,
  setOwnerOutputSchema,
  setVerifiedFactsInputSchema,
  setVerifiedFactsOutputSchema,
  explainReachOutputSchema,
  applyNetworkRulesInputSchema,
  checkNetworkRulesFileInputSchema,
  checkNetworkRulesFileOutputSchema,
  importNetworkRulesInputSchema,
  importNetworkRulesOutputSchema,
  exportNetworkRulesOutputSchema,
  discardNetworkRulesDraftOutputSchema,
  networkRulesDraftChangesOutputSchema,
  networkRulesOutputSchema,
  networkVersionOutputSchema,
  saveNetworkRulesDraftInputSchema,
  saveNetworkRulesDraftOutputSchema,
  setBuiltInRuleInputSchema,
  builtInRulesOutputSchema,
  declareNetworkRulesInputSchema,
  declareNetworkRulesOutputSchema,
  declaredNetworkRulesOutputSchema,
  findLabelValueOutputSchema,
  fleetListInputSchema,
  labelWriteOutputSchema,
  labelsOutputSchema,
  scopesOutputSchema,
  unassignLabelInputSchema,
} from '@aeolus-fleet/common';
import { tracked, type TrackedEnvelope } from '@trpc/server';
// The subscription's output type names TrackedData, which tRPC exports only
// here; the declarations the build emits need a path to reach it by.
import type {} from '@trpc/server/unstable-core-do-not-import';

import type { ListedShip } from '../../domain/registry/list-fleet.js';
import type { PingStatus } from '../../domain/registry/ping-status.js';
import type { ShipFacts } from '../../domain/registry/ports.js';
import type { NetworkRule } from '../../domain/registry/network-settings.js';
import type { RefusedActor } from '../../domain/registry/reach-refusal.js';
import type { DeliveryWay } from '../../domain/shared/delivery-way.js';
import type { SequencedEvent } from '../../domain/shared/events.js';
import type { InboxEntry } from '../../domain/shared/history.js';
import type { ListedPayload } from '../../domain/messaging/public.js';
import { listedPayloadOutputOf } from './listed-payload.js';
import { describedAcknowledged, describedHealth, describedPerHour, describedStuck } from './health.js';
import { presentStartingPrompt } from './starting-prompt-text.js';
import { schedulesPageOf } from './schedule-output.js';
import { actorAllScopesProcedure, actorAnyScopeProcedure, actorProcedure, actorScopedProcedure, anyScopeProcedure, callerStillHolding, okOrThrow, ownPersonShipOrAnyScopeProcedure, router, scopedCrewCallerProcedure, scopedProcedure } from './trpc.js';

/** A crew request as the API answers it: its times in ISO 8601, and when its session started as `startedAt`. */
function crewRequestOutputOf<T extends { requestedAt: Date; sessionStartedAt: Date | null; givenBack: ShipFacts['crewRequestGivenBack'] }>(request: T | null) {
  if (request === null) {
    return null;
  }
  const { sessionStartedAt, givenBack, ...rest } = request;
  return {
    ...rest,
    requestedAt: request.requestedAt.toISOString(),
    startedAt: sessionStartedAt?.toISOString() ?? null,
    givenBack: givenBack.map((back) => ({ ...back, givenBackAt: back.givenBackAt.toISOString() })),
  };
}

/** A ship's last ping as the API states it: its dates in ISO 8601. */
/** A delivery's way as the API answers it: its times in ISO 8601. */
function inboxEntryOutputOf(entry: InboxEntry<ListedPayload>) {
  return {
    ...entry,
    readAt: entry.readAt?.toISOString() ?? null,
    doneAt: entry.doneAt?.toISOString() ?? null,
    replies: entry.replies.map((reply) => ({ ...reply, ...listedPayloadOutputOf(reply.payload), sentAt: reply.sentAt.toISOString() })),
    message: { ...entry.message, ...listedPayloadOutputOf(entry.message.payload), sentAt: entry.message.sentAt.toISOString() },
  };
}

function wayOutputOf(way: DeliveryWay) {
  return {
    ...way,
    since: way.since.toISOString(),
    overdue: way.overdue && { ...way.overdue, toldAt: way.overdue.toldAt.toISOString() },
    lease: way.lease && {
      ...way.lease,
      turn: way.lease.turn && { turn: way.lease.turn.state, at: way.lease.turn.at.toISOString() },
    },
    crew: way.crew && { ...way.crew, startedAt: way.crew.startedAt?.toISOString() ?? null },
  };
}

function pingOutputOf(ping: PingStatus | null) {
  return ping && { state: ping.state, sentAt: ping.sentAt.toISOString(), answeredAt: ping.answeredAt?.toISOString() ?? null };
}

/**
 * Fleet procedures: commission ships, hand out their starting prompts, release
 * them, list the fleet and follow it live, read a ship's page (the ship, its
 * timeline, its messages and one message's delivery history), and Needs
 * attention: the undeliverable and not handled deliveries, resent or dismissed, and argo's
 * inbox: the messages to it, read, marked done or replied to. The caller's
 * fleet and ship come from its credentials, never from the input.
 */
export const fleetRouter = router({
  /** A new agent ship awaiting crew, and its first starting prompt: shown once. */
  commission: actorAnyScopeProcedure('fleet:commission', 'fleet:person', 'fleet:connect')
    .meta({
      description: [
        'Needs fleet:commission, fleet:person for a person ship, or fleet:connect for a plugin ship. Commissions a new ship awaiting crew, for a ship, an account or the installation: name and type are handles (lowercase letters, digits, hyphens, colons).',
        'scopes adds scopes to the two every ship has, each one you may grant: a core scope you hold, or a declared scope of the namespace your ship declared. fleet_grantScopes changes them later.',
        "The new ship's owner is your owner, you when you are a person ship, or your person ship when you are an account; an account without a person ship in the fleet is refused.",
        'valueIds gives it label values from the start, each a value of a label you defined or a value you carry yourself (decision 0053).',
        "ownerOf, which needs fleet:on-behalf, names the ship that asked it for this one: the new ship gets that ship's owner instead of yours.",
        'kind is agent unless you state person, app or plugin: a person ship needs fleet:person instead and owns itself, an app ship needs fleet:on-behalf as well, and a plugin ship needs fleet:connect instead, which connects it (decision 0050).',
        "owner, which needs fleet:on-behalf and only for an app ship, names the owner argo picked for it: a person's ship or argo, never beside ownerOf.",
        'Answers its shipId, its first starting prompt, one crew line per harness (claude-code, codex) and its secret, shown only this once.',
        'idempotencyKey is a new unique string for every commission. Reuse one only to retry the same commission after an error or a lost answer:',
        'the retry answers the same shipId with prompt, crewLines and secret null and how its starting prompt stands (fleet_getStartingPrompt gives a new one), and a different commission with a used key is refused (CONFLICT).',
      ].join(' '),
    })
    .input(commissionShipInputSchema)
    .output(commissionShipOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { shipId, secret, startingPrompt } = okOrThrow(await ctx.useCases.commissionShip(ctx.caller, input));
      const presented = secret === null ? { prompt: null, crewLines: null, secret: null } : presentStartingPrompt({ fleetUrl: ctx.fleetUrl, shipId, secret });
      return { ...presented, shipId, startingPrompt: startingPrompt && { ...startingPrompt, issuedAt: startingPrompt.issuedAt.toISOString() } };
    }),

  /** A new starting prompt for a ship awaiting crew. Its secret invalidates the previous one. */
  getStartingPrompt: ownPersonShipOrAnyScopeProcedure({ isShipCallOtherwise: true }, 'fleet:manage', 'crew:run')
    .meta({
      description: [
        'Needs fleet:manage, or crew:run for a ship whose crew request is assigned to yours; an account needs nothing for its own person ship. A new starting prompt, one crew line per harness and the secret for a ship awaiting crew; its new secret stops any earlier one working.',
      ].join(' '),
    })
    .input(getStartingPromptInputSchema)
    .output(startingPromptOutputSchema)
    .mutation(async ({ ctx, input }) =>
      presentStartingPrompt({ fleetUrl: ctx.fleetUrl, ...okOrThrow(await ctx.useCases.getStartingPrompt(ctx.caller, input)) }),
    ),

  /**
   * Pings a crewed ship: a message its session answers with pong, proving
   * its model is working. Pings never stack: while one waits unanswered, this
   * answers with that one. Never argo, a ship awaiting crew or a retired one.
   */
  ping: actorScopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. Pings a crewed ship: its session answers with pong, proving it is working.',
        'Pings never stack: while one waits unanswered, this answers with that one (isNew false). Never argo, a ship awaiting crew or a retired one.',
      ].join(' '),
    })
    .input(pingShipInputSchema)
    .output(pingShipOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const pinged = okOrThrow(await ctx.useCases.pingShip(ctx.caller, input));
      return { ...pinged, sentAt: pinged.sentAt.toISOString() };
    }),

  /**
   * Frees a crewed ship from the session crewing it: its crew token and secret
   * stop working, and what it held in flight returns to pending for the next
   * crew. Never argo; a ship awaiting crew gets a new starting prompt instead.
   */
  release: ownPersonShipOrAnyScopeProcedure({ isShipCallOtherwise: false }, 'fleet:manage', 'crew:run')
    .meta({
      description: [
        'Needs fleet:manage, or crew:run for a ship whose crew request is assigned to yours; an account needs nothing for its own person ship. Frees a crewed ship from its session: its crew token and secret stop working, and what it held in flight returns to pending.',
        'Never argo; a ship awaiting crew gets a new starting prompt instead.',
      ].join(' '),
    })
    .input(releaseShipInputSchema)
    .output(releaseShipOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.releaseShip(ctx.caller, input));
      return {};
    }),

  /**
   * Ends a ship for good, crewed or not, never argo: its lease and secret end,
   * its direct deliveries are abandoned, deliveries to its type stay for the
   * other ships of the type. Answers how many it abandoned.
   */
  retire: actorScopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. Ends a ship permanently, never argo: its lease and secret end and its direct deliveries are abandoned.',
        'Answers how many it abandoned.',
      ].join(' '),
    })
    .input(retireShipInputSchema)
    .output(retireShipOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.retireShip(ctx.caller, input))),

  /** A ship's schedules, for an actor that manages it (decision 0062): as ship.schedules lists a ship's own. */
  schedules: actorScopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage, within manage reach of the ship. Lists the ship\'s schedules, newest first, as it lists its own with schedules:',
        'active and paused ones unless states names others, a page at a time.',
      ].join(' '),
    })
    .input(fleetSchedulesInputSchema)
    .output(schedulesOutputSchema)
    .query(async ({ ctx, input }) =>
      schedulesPageOf(
        okOrThrow(
          await ctx.useCases.listSchedules(ctx.caller, {
            shipId: input.shipId,
            limit: input.limit ?? PAGE_SIZE_DEFAULT,
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            ...(input.states === undefined ? {} : { states: input.states }),
          }),
        ),
      ),
    ),

  /** Pauses any ship's schedule, for an actor that manages it; only its ship resumes it (decision 0062, S10). */
  pauseSchedule: actorScopedProcedure('fleet:manage')
    .meta({
      description: 'Needs fleet:manage, within manage reach of the schedule\'s ship. Pauses the schedule by its scheduleId: it sends nothing until its ship resumes it.',
    })
    .input(pauseScheduleInputSchema)
    .output(pauseScheduleOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.pauseSchedule(ctx.caller, input))),

  /** Cancels any ship's schedule, for an actor that manages it: the fail-safe for a schedule that misbehaves (decision 0062). */
  cancelSchedule: actorScopedProcedure('fleet:manage')
    .meta({
      description: 'Needs fleet:manage, within manage reach of the schedule\'s ship. Cancels the schedule by its scheduleId: it sends nothing more.',
    })
    .input(cancelScheduleInputSchema)
    .output(cancelScheduleOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.cancelSchedule(ctx.caller, input))),

  /**
   * Asks that a ship be kept crewed, with crew settings it checks but never acts on,
   * replacing any request it holds (decision 0029).
   */
  crewRequest: actorScopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. Asks that a ship be kept crewed, with settings: one JSON object of at most 16 KB (harness, workspace, options,',
        'an optional first prompt, squadron and machine labels), refused with the reason unless they are crew settings whose machine labels are label',
        'value ids of the fleet. Replaces the settings of a request the ship holds.',
        'Never argo, the viewer or a retired ship. Answers the settings version, one more on every request.',
        'It answers so even for settings no trierarch takes (harness, workspace, options): read the crew request status and reason on fleet_ship afterwards.',
      ].join(' '),
    })
    .input(crewRequestInputSchema)
    .output(crewRequestOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.requestCrew(ctx.caller, input))),

  /** Removes a ship's crew request; its crew, if any, stays aboard. */
  removeCrewRequest: actorScopedProcedure('fleet:manage')
    .meta({
      description: ["Needs fleet:manage. Removes a ship's crew request. NOT_FOUND when it holds none."].join(' '),
    })
    .input(removeCrewRequestInputSchema)
    .output(removeCrewRequestOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.removeCrewRequest(ctx.caller, input));
      return {};
    }),

  /** Assigns a ship's crew request to a trierarch, only while it is unassigned (optimistic claim, decision 0029). */
  assignCrew: actorScopedProcedure('crew:assign')
    .meta({
      description: [
        "Needs crew:assign. Assigns a ship's crew request to a trierarch ship (any active ship of the fleet), only while it is unassigned:",
        'a lost claim is CONFLICT, so read again. Never a crewed ship: crewing it by hand fulfils its request.',
      ].join(' '),
    })
    .input(assignCrewInputSchema)
    .output(assignCrewOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.assignCrew(ctx.caller, input));
      return {};
    }),

  /** The assigner writes why no trierarch can take a ship's unassigned crew request. */
  explainCrewRequest: actorScopedProcedure('crew:assign')
    .meta({
      description: [
        "Needs crew:assign. Writes why no trierarch can take a ship's unassigned crew request (one line, at most 200 characters),",
        "shown in the operator's needs-crew to-do; null clears it, and an assignment clears it.",
      ].join(' '),
    })
    .input(explainCrewRequestInputSchema)
    .output(explainCrewRequestOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.explainCrewRequest(ctx.caller, input));
      return {};
    }),

  /** The assigned trierarch writes how its crew of a ship stands. */
  reportCrewStatus: scopedProcedure('crew:run')
    .meta({
      description: [
        "Needs crew:run, for a ship whose crew request is assigned to yours. Says how its crew stands: crewing, running, restarting, crashed or releasing.",
        'Once the request is releasing, only releasing: stop its session, end its lease, then call confirmCrewRelease.',
      ].join(' '),
    })
    .input(reportCrewStatusInputSchema)
    .output(reportCrewStatusOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.reportCrewStatus(ctx.caller, input));
      return {};
    }),

  /** The assigned trierarch confirms it released the ship of a releasing request, which then goes (the finalizer). */
  confirmCrewRelease: scopedProcedure('crew:run')
    .meta({
      description: [
        'Needs crew:run, for a ship whose crew request is assigned to yours and releasing. Confirms you stopped its session,',
        'ended its lease and cleaned its workspace; the request then goes.',
      ].join(' '),
    })
    .input(confirmCrewReleaseInputSchema)
    .output(confirmCrewReleaseOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.confirmCrewRelease(ctx.caller, input));
      return {};
    }),

  /** The assigned trierarch gives back a request it tried to fulfil and failed, before its crew is final (#382). */
  giveBackCrewRequest: scopedProcedure('crew:run')
    .meta({
      description: [
        'Needs crew:run, for a ship whose crew request is assigned to yours. Gives the request back, with a reason, while its crew is not final (no status, or crewing),',
        'for the settings version you tried: the request is unassigned, the ship released, and your trierarch left out when it is placed again.',
      ].join(' '),
    })
    .input(giveBackCrewRequestInputSchema)
    .output(giveBackCrewRequestOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.giveBackCrewRequest(ctx.caller, input));
      return {};
    }),

  /** The crew requests assigned to the caller's ship: a trierarch's ships. */
  assignedCrewRequests: scopedProcedure('crew:run')
    .meta({
      description: ['Needs crew:run. The crew requests assigned to your ship, oldest ship first: each ship, its settings and their version, its status, whether its crew is final, and the owner of its ship by id and name (decision 0045).'].join(
        ' ',
      ),
    })
    .output(assignedCrewRequestsOutputSchema)
    .query(async ({ ctx }) =>
      (await ctx.useCases.readAssignedCrewRequests(ctx.caller)).map((request) => ({ ...request, requestedAt: request.requestedAt.toISOString() })),
    ),

  /** Asks a trierarch to clear a worktree it kept, named by its ship and repository (decision 0032). */
  clearWorktree: actorScopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. Asks a trierarch ship to clear the worktree it kept for a ship in a repository, named as its report names it, never a path.',
        'The request stays pending until the trierarch confirms; it is never withdrawn. Asking again for the same worktree changes nothing.',
        'At most 100 pending per trierarch.',
      ].join(' '),
    })
    .input(clearWorktreeInputSchema)
    .output(clearWorktreeOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.requestWorktreeClear(ctx.caller, input));
      return {};
    }),

  /** The pending clear requests: every trierarch's to fleet:read, the caller's own to crew:run. */
  clearRequests: anyScopeProcedure('fleet:read', 'crew:run')
    .meta({
      description: [
        "Needs fleet:read or crew:run. The pending clear requests: with fleet:read every trierarch's for the ships in your read reach (decision 0034), with crew:run those to your ship.",
        'Each names the trierarch, the worktree by its ship and repository, who asked and when.',
      ].join(' '),
    })
    .output(clearRequestsOutputSchema)
    .query(async ({ ctx }) =>
      (await ctx.useCases.readClearRequests(ctx.caller)).map((request) => ({ ...request, requestedAt: request.requestedAt.toISOString() })),
    ),

  /** The trierarch confirms a clear request to its ship: it removed the worktree, or kept none (decision 0032). */
  confirmWorktreeCleared: scopedProcedure('crew:run')
    .meta({
      description: [
        'Needs crew:run, for a clear request to your ship. Confirms you removed the kept worktree (removed) or kept no such worktree (not-kept);',
        'the request then goes.',
      ].join(' '),
    })
    .input(confirmWorktreeClearedInputSchema)
    .output(confirmWorktreeClearedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.confirmWorktreeCleared(ctx.caller, input));
      return {};
    }),

  /**
   * Gives a ship a new name, any ship but argo or a retired one. Its id,
   * history and session stay; a sender addressing the old name no longer
   * reaches it.
   */
  rename: actorScopedProcedure('fleet:manage')
    .input(renameShipInputSchema)
    .output(renameShipOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.renameShip(ctx.caller, input));
      return {};
    }),

  /** Gives a ship within the caller's manage reach a new owner, an active person's ship or argo (decisions 0045, 0053). */
  setOwner: actorScopedProcedure('fleet:owner')
    .input(setOwnerInputSchema)
    .output(setOwnerOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.setOwner(ctx.caller, input));
      return {};
    }),

  /**
   * Turns sealing on for the fleet (decision 0068, B4): every payload it
   * stores from then on is sealed under a data key its company key wraps,
   * and the sealing pass seals what it stored plain before.
   */
  turnOnSealing: actorScopedProcedure('fleet:keys')
    .input(turnOnSealingInputSchema)
    .output(turnOnSealingOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const turnedOn = okOrThrow(await ctx.useCases.turnOnSealing(ctx.caller, input));
      ctx.log.info({ fleetId: ctx.caller.fleetId, companyKey: turnedOn.companyKey, recoveryKeyFingerprint: turnedOn.recoveryKeyFingerprint, state: turnedOn.state }, 'sealing turned on');
      return turnedOn;
    }),

  /**
   * Moves every data key of the sealed fleet to a new company key (decision
   * 0068, B13c), rewrapped inside the company's KMS; the old key must be
   * reachable. No payload is sealed again.
   */
  changeCompanyKey: actorScopedProcedure('fleet:keys')
    .input(changeCompanyKeyInputSchema)
    .output(changeCompanyKeyOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const changed = okOrThrow(await ctx.useCases.changeCompanyKey(ctx.caller, input));
      ctx.log.info({ fleetId: ctx.caller.fleetId, companyKey: changed.companyKey }, 'company key changed');
      return changed;
    }),

  /**
   * Wraps every data key of the sealed fleet to a new recovery key, or sets
   * one on a fleet sealed without (decision 0068, B13d): an age X25519
   * recipient, the public half of the company's offline key pair. The
   * company key must be reachable. No payload is sealed again.
   */
  changeRecoveryKey: actorScopedProcedure('fleet:keys')
    .input(changeRecoveryKeyInputSchema)
    .output(changeRecoveryKeyOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const changed = okOrThrow(await ctx.useCases.changeRecoveryKey(ctx.caller, input));
      ctx.log.info({ fleetId: ctx.caller.fleetId, recoveryKeyFingerprint: changed.recoveryKeyFingerprint }, 'recovery key changed');
      return changed;
    }),

  /**
   * The sealed fleet's recovery set (decision 0068, B15): each data key
   * wrapped to the recovery key alone, with its check value, for the recovery
   * command on the company's computer. Nothing in it opens with any key
   * Aeolus can use.
   */
  recoverySet: actorScopedProcedure('fleet:keys')
    .output(recoverySetOutputSchema)
    .query(async ({ ctx }) => {
      const set = okOrThrow(await ctx.useCases.readRecoverySet(ctx.caller));
      return {
        ...set,
        dataKeys: set.dataKeys.map(({ id, wrappedByRecoveryKey, checkValue }) => ({ id, wrappedByRecoveryKey: base64Of(wrappedByRecoveryKey), checkValue: base64Of(checkValue) })),
      };
    }),

  /**
   * Recovers the sealed fleet's data keys under a new company key (decision
   * 0068, B15), as the recovery command wrapped them in the company's KMS:
   * every wrap must open to its data key, or nothing changes. No payload is
   * sealed again.
   */
  recoverKeys: actorScopedProcedure('fleet:keys')
    .input(recoverKeysInputSchema)
    .output(recoverKeysOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const dataKeys = input.dataKeys.map(({ id, wrappedByCompanyKey }) => ({ id, wrappedByCompanyKey: new Uint8Array(Buffer.from(wrappedByCompanyKey, 'base64')) }));
      const recovered = okOrThrow(await ctx.useCases.recoverKeys(ctx.caller, { companyKey: input.companyKey, dataKeys }));
      ctx.log.info({ fleetId: ctx.caller.fleetId, companyKey: recovered.companyKey, dataKeys: dataKeys.length }, 'data keys recovered');
      return recovered;
    }),

  /**
   * The fleet's sealing (decision 0068, B5, B11): none, or its state and
   * since when, the sealing pass's progress, its company key by reference, whether that key answered its last unwrap and
   * since when, and its data keys' ages. Never a key.
   */
  sealing: actorScopedProcedure('fleet:read')
    .output(sealingOutputSchema)
    .query(async ({ ctx }) => {
      const sealing = await ctx.useCases.readSealing(ctx.caller);
      if (sealing.state === 'none') {
        return sealing;
      }
      const { since, keyAvailability, dataKeys } = sealing;
      return {
        ...sealing,
        since: since.toISOString(),
        keyAvailability: { ...keyAvailability, since: keyAvailability.since.toISOString() },
        dataKeys: dataKeys.map((dataKey) => ({ ...dataKey, createdAt: dataKey.createdAt.toISOString() })),
      };
    }),

  /**
   * Whether the caller manages a ship now, by the rule every fleet:manage
   * call checks (decision 0034): the gateway asks it as an approver before it
   * changes what a proxy ship's tools need (design gateway-scopes 4.2).
   */
  checkManage: actorProcedure
    .meta({
      description: [
        'Needs no scope. Answers OK when the ship is within your manage reach, by the rule every fleet:manage call checks (decision 0034).',
        'A ship outside it is refused NOT_REACHABLE, naming no rule, and the refusal is recorded as any manage refusal is; a ship that does not exist is refused SHIP_NOT_FOUND.',
      ].join(' '),
    })
    .input(checkManageInputSchema)
    .output(checkManageOutputSchema)
    .query(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.checkManage(ctx.caller, input));
      return {};
    }),

  /**
   * A new crew for a crewed ship whose session is gone: a release and a new
   * starting prompt in one transaction. Its prompt, crew lines and secret are shown once.
   */
  recrew: actorScopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. A new crew for a crewed ship whose session is gone: releases it and answers a fresh starting prompt, one crew line per harness and the secret, shown once. Never argo.',
      ].join(' '),
    })
    .input(recrewShipInputSchema)
    .output(startingPromptOutputSchema)
    .mutation(async ({ ctx, input }) =>
      presentStartingPrompt({ fleetUrl: ctx.fleetUrl, ...okOrThrow(await ctx.useCases.recrewShip(ctx.caller, input)) }),
    ),

  /**
   * The fleet's ship and daily message limits with what each counts, when
   * today's message count starts again, and its retention: what the console
   * shows at a limit, and how long the fleet keeps its finished history.
   */
  limits: actorScopedProcedure('fleet:read')
    .meta({
      description: [
        "Needs fleet:read. The fleet's ship limit with its ships that are not retired (argo included), and its daily message limit with the messages it stored since 00:00 UTC and when that count starts again. A limit of null is none. Its retention: the days it keeps its finished history, null when no retention applies, and keptFrom, where its kept history begins: older finished history is no longer kept, older open deliveries are; null while nothing was pruned.",
      ].join(' '),
    })
    .output(fleetLimitsOutputSchema)
    .query(async ({ ctx }) => {
      const { ships, dailyMessages, retention } = await ctx.useCases.readFleetLimits(ctx.caller);
      return {
        ships,
        dailyMessages: { ...dailyMessages, resetsAt: dailyMessages.resetsAt.toISOString() },
        retention: { days: retention.days, keptFrom: retention.keptFrom?.toISOString() ?? null },
      };
    }),

  /** A page of the caller's fleet, each ship with its status and prompt state, or of the ships that carry the label values given. Never a secret. */
  list: actorScopedProcedure('fleet:read')
    .meta({
      description: [
        'Needs fleet:read. A page of the active ships of the fleet, argo included, and of the retired ones only when status asks for retired: id, name, type, kind, status, scopes, labels, where its session runs and in which harness, when it was last seen, its last ping, and its current model (the last its sessions stated). Never a secret.',
        `A page holds limit ships (${String(PAGE_SIZE_DEFAULT)} unless you ask, at most ${String(PAGE_SIZE_MAX)}); nextCursor is where the next page starts: pass it as cursor, with the same filters and sort, to read on, until it is null. A page that selects by label may hold fewer ships than limit while more follow.`,
        'Ordered argo first, then by name; or by sort: a column (ship, status, report, runsOn, seen, requested: when crew was requested, the oldest first) A to Z or Z to A, ships with nothing in it last, ties by name.',
        'A ship outside your read reach shows its id, name, type and status only, with isInReadReach false (decision 0034).',
        'With valueIds (label value ids, from fleet_labels or fleet_findLabelValue), only the ships in your read reach that carry every one of them: exact matches, combined with AND.',
        'Filters, each combined with AND: query (text the name or type holds, in any case); name (the exact name of a ship); shipKind (operator, person, agent, ...: argo and the person ships for an owner picker); status, type, shipIds, assignedTo (the trierarch ships a crew request is assigned to), needsCrew (withTrierarchs or withoutTrierarchs: the ships on Needs crew as the trierarch plugin being connected decides), crewRequest (none, needsCrew, crewedByHand, or the status the trierarch wrote) and kind (console, claudeCode, codex, trierarch, plugin as pluginShipIds names them, other) take any of the values given.',
      ].join(' '),
    })
    .input(fleetListInputSchema)
    .output(fleetListOutputSchema)
    .query(async ({ ctx, input }) => {
      const { ships, nextCursor } = await ctx.useCases.listFleet(ctx.caller, input);
      return { items: ships.map((ship) => (isInReadReach(ship) ? listedShipOutputOf(ship) : ship)), nextCursor: nextCursor && shipCursorOf(nextCursor) };
    }),

  /** The fleet's labels, each with its values and its owner (decision 0031). */
  labels: actorScopedProcedure('fleet:read')
    .meta({
      description: ["Needs fleet:read. The fleet's labels by key: each with its id, its values with their ids, and its owner ship, by id and name."].join(' '),
    })
    .output(labelsOutputSchema)
    .query(async ({ ctx }) => (await ctx.useCases.listLabels(ctx.caller)).map((label) => ({ ...label, values: [...label.values] }))),

  /** Every namespace of the fleet and its scopes, core first (decision 0046). */
  scopes: actorScopedProcedure('fleet:read')
    .meta({
      description: [
        "Needs fleet:read. The fleet's scopes by namespace, each saying whose it is by kind (core, plugin or fleet): the core namespaces first (messages, fleet, crew, labels, scopes, meetings), declared by no ship,",
        "then each plugin namespace and each namespace of the fleet's own scopes by name, a plugin namespace with the ship that declared it by id and name. Each scope with its one-line description.",
      ].join(' '),
    })
    .output(scopesOutputSchema)
    .query(async ({ ctx }) => (await ctx.useCases.listScopes(ctx.caller)).map((namespace) => ({ ...namespace, scopes: [...namespace.scopes] }))),

  /** Takes up the caller's plugin namespace with its whole list of scopes (decision 0046). */
  declareScopes: scopedProcedure('scopes:declare')
    .meta({
      description: [
        'Needs scopes:declare. Takes up one plugin namespace for your ship, kept until it retires, with its whole list of scopes: each <namespace>:<action> with a one-line description, at most 20.',
        'Declaring the whole list once more adds scopes or changes descriptions; removing a scope a ship holds is CONFLICT. Core stores your scopes and never checks them: your plugin enforces them.',
        'A core namespace is refused; a namespace another ship took, or a second namespace, is CONFLICT. The namespace goes when your ship retires.',
      ].join(' '),
    })
    .input(declareScopesInputSchema)
    .output(declareScopesOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { namespace, scopes } = okOrThrow(await ctx.useCases.declareScopes(ctx.caller, input));
      return { namespace, scopes: [...scopes] };
    }),

  /** Grants and revokes scopes on a live ship, within what the caller's ship may grant (decision 0046). */
  grantScopes: actorScopedProcedure('scopes:grant')
    .meta({
      description: [
        'Needs scopes:grant. Grants and revokes scopes on a live agent, person or app ship at once; its crew holds them from its next call.',
        "Each scope is one your ship holds: a core scope, a declared plugin scope, or one of the fleet's own scopes; a namespace's declarer may also grant its plugin namespace's scopes. Revoking follows the same rule.",
        "messages:send and messages:receive are never revoked; argo's, the viewer's and your own ship's scopes are not changed here. Answers every scope the ship holds now.",
      ].join(' '),
    })
    .input(grantScopesInputSchema)
    .output(grantScopesOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { scopes } = okOrThrow(await ctx.useCases.grantScopes(ctx.caller, input));
      return { scopes: [...scopes] };
    }),

  /** Defines one of the fleet's own scopes (design gateway-scopes, 4.1). */
  defineScope: actorScopedProcedure('scopes:define')
    .meta({
      description: [
        "Needs scopes:define. Defines one of the fleet's own scopes, <namespace>:<action> in the company's words such as crm:read-leads, with a one-line description of 1 to 200 characters.",
        'A core namespace, a namespace reserved for a plugin Aeolus knows (gateway, squadrons, trierarch) and a namespace a plugin declared are refused; a scope the fleet has is CONFLICT.',
        "The fleet's scopes have no cap. Defining a scope grants it to no one: argo holds it, and an actor that holds it grants it onwards with scopes:grant.",
      ].join(' '),
    })
    .input(defineScopeInputSchema)
    .output(definedScopeOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.defineScope(ctx.caller, input))),

  /** Changes the description of one of the fleet's own scopes (design gateway-scopes, 4.1). */
  describeScope: actorScopedProcedure('scopes:define')
    .meta({
      description: [
        "Needs scopes:define. Changes the one-line description of one of the fleet's own scopes. A scope is never renamed: a new name is a new scope.",
      ].join(' '),
    })
    .input(defineScopeInputSchema)
    .output(definedScopeOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.describeScope(ctx.caller, input))),

  /** Removes one of the fleet's own scopes, refused while a ship holds it (design gateway-scopes, 4.1). */
  removeScope: actorScopedProcedure('scopes:define')
    .meta({
      description: [
        "Needs scopes:define. Removes one of the fleet's own scopes. While an active ship holds it, the removal is CONFLICT, naming how many ships: revoke it from them first.",
        'Removing the last scope of a namespace frees it for a plugin.',
      ].join(' '),
    })
    .input(removeScopeInputSchema)
    .output(removeScopeOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.removeScope(ctx.caller, input));
      return {};
    }),

  /** Sets the caller's verified facts about a ship within its manage reach, whole (decision 0059). */
  setVerifiedFacts: actorScopedProcedure('fleet:verify')
    .meta({
      description: [
        'Needs fleet:verify, and manage reach on the ship (decision 0059). Sets what your ship checked about a ship, whole, in place of the facts it wrote before; none withdraws them.',
        "Each fact names what was checked (clientIdDocumentDomain, tlsHost, a2aCardDomain, or oauthSubject with the issuer it means something under) and the value the check found; at most 10, each once. Another writer's facts stay.",
        "The fleet stores them as written and checks nothing in them; discovery shows them beside the ship's statement, naming your ship as their writer.",
      ].join(' '),
    })
    .input(setVerifiedFactsInputSchema)
    .output(setVerifiedFactsOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.setVerifiedFacts(ctx.caller, input));
      return {};
    }),

  /** Defines a label the caller's ship then owns (decision 0031). */
  defineLabel: actorScopedProcedure('labels:define')
    .meta({
      description: [
        'Needs labels:define. Defines a label your ship then owns: a key unique in the fleet and its values, 1 to 50, each once.',
        'Keys and values are lowercase a-z, 0-9 and -, at most 63 characters (decision 0031). A key the fleet has is CONFLICT, naming its owner.',
        'Answers the label id and each value with its id: assigning and selecting take the ids. The label retires with its owner.',
      ].join(' '),
    })
    .input(defineLabelInputSchema)
    .output(defineLabelOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { labelId, values } = okOrThrow(await ctx.useCases.defineLabel(ctx.caller, input));
      return { labelId, values: [...values] };
    }),

  /** The owner gives its label the values it has from now on. */
  changeLabelValues: actorScopedProcedure('labels:define')
    .meta({
      description: [
        "Needs labels:define, and only the label's owner changes it. Gives the label, by its id, every value it has from now on, adding and removing at once, within decision 0031's limits.",
        'A value it has keeps its id. A value ships carry is never removed: CONFLICT, naming the ships that carry it. Answers each value with its id.',
      ].join(' '),
    })
    .input(changeLabelValuesInputSchema)
    .output(changeLabelValuesOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { values } = okOrThrow(await ctx.useCases.changeLabelValues(ctx.caller, input));
      return { values: [...values] };
    }),

  /** The owner gives a ship one of its label's values. */
  assignLabel: actorScopedProcedure('labels:assign')
    .meta({
      description: [
        "Needs labels:assign, and only the label's owner assigns it. Gives a ship one of its values, by the value's id, beside the values the ship carries.",
        'Any ship, your own ship included, but never a retired one. A ship carries at most 20 label values (decision 0031).',
      ].join(' '),
    })
    .input(assignLabelInputSchema)
    .output(labelWriteOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.assignLabel(ctx.caller, input));
      return {};
    }),

  /** The owner takes its label off a ship. */
  unassignLabel: actorScopedProcedure('labels:assign')
    .meta({
      description: ["Needs labels:assign, and only the label's owner unassigns it. Takes one of its values off a ship, by the value's id; a ship that does not carry it changes nothing."].join(' '),
    })
    .input(unassignLabelInputSchema)
    .output(labelWriteOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.unassignLabel(ctx.caller, input));
      return {};
    }),

  /** The owner deletes its label, freeing its key. */
  deleteLabel: actorScopedProcedure('labels:define')
    .meta({
      description: [
        "Needs labels:define, and only the label's owner deletes it. Deletes the label, by its id, with its values, freeing its key.",
        'A label any ship carries a value of is never deleted: CONFLICT, naming the ships that carry it.',
      ].join(' '),
    })
    .input(deleteLabelInputSchema)
    .output(labelWriteOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.deleteLabel(ctx.caller, input));
      return {};
    }),

  /** The ids of a label and one of its values, by their texts. */
  findLabelValue: actorScopedProcedure('fleet:read')
    .meta({
      description: [
        'Needs fleet:read. The label id and the value id for a key and a value as people write them (os, macos): both lowercased, then matched exactly.',
        'Assigning and selecting take the ids. A key or value the fleet does not have is NOT_FOUND.',
      ].join(' '),
    })
    .input(findLabelValueInputSchema)
    .output(findLabelValueOutputSchema)
    .query(async ({ ctx, input }) => okOrThrow(await ctx.useCases.findLabelValue(ctx.caller, input))),

  /** The fleet's own rules as applied, and the draft beside them (decision 0034). */
  networkRules: actorScopedProcedure('fleet:network')
    .meta({
      description: [
        "Needs fleet:network. The fleet's own network rules as applied, at the settings version, and the draft beside them, with when it was saved and against which version, or null without one (decision 0034).",
        'Rules of null are none applied: all-to-all, open on. A fleet that never set rules answers null at version 0.',
      ].join(' '),
    })
    .output(networkRulesOutputSchema)
    .query(async ({ ctx }) => {
      const { applied, draft } = okOrThrow(await ctx.useCases.readNetworkRules(ctx.caller));
      return {
        applied: { rules: rulesOutputOf(applied.rules), version: applied.version },
        draft: draft === null ? null : { rules: rulesOutputOf(draft.rules), savedAt: draft.savedAt.toISOString(), savedAgainstVersion: draft.savedAgainstVersion },
      };
    }),

  /** Saves the draft of the fleet's own rules, the whole list or none (decision 0034). */
  saveNetworkRulesDraft: actorScopedProcedure('fleet:network')
    .meta({
      description: [
        "Needs fleet:network. Saves the draft of the fleet's own network rules, the whole list at once, in place of the draft before; nothing is in force until fleet_applyNetworkRules applies it. Each rule names its verb, send, read or manage, and lets the ships for which every term in from holds do it to the ships for which every term in to holds; an empty selector matches every ship.",
        'A term is a label value id, the ship carries that value; { labelId, value: "*" }, the ship carries any value of the label; { labelId, value: "#" }, the ships on both sides carry the same value of the label; or { owner } with a ship id, "*" or "#", for the owner the same way. A "#" binds its label or the owner on both sides, so a "#" on one side only is refused.',
        "Allow-only, beside the built-in rules: argo reaches every ship and every ship reaches argo, an owner's ship reaches the ships it owns, and a ship always answers the sender of a message it received; and beside the rules the fleet's ships declared.",
        'rules null is all-to-all: open lets every ship reach every ship. An empty list allows only the built-in and declared rules. Each selector at most 20 terms, each once (decision 0034), and at most 200 rules, beside the declared ones (decision 0037). Answers the settings version it was saved against, which the apply names.',
      ].join(' '),
    })
    .input(saveNetworkRulesDraftInputSchema)
    .output(saveNetworkRulesDraftOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.saveNetworkRulesDraft(ctx.caller, input))),

  /** The draft goes, the applied rules staying as they are (decision 0034). */
  discardNetworkRulesDraft: actorScopedProcedure('fleet:network')
    .meta({
      description: "Needs fleet:network. Discards the fleet's draft of its network rules; the applied rules stay as they are (decision 0034). A fleet without a draft is NOT_FOUND.",
    })
    .output(discardNetworkRulesDraftOutputSchema)
    .mutation(async ({ ctx }) => {
      okOrThrow(await ctx.useCases.discardNetworkRulesDraft(ctx.caller));
      return {};
    }),

  /** What applying the draft would change: per verb, the reach it gains and loses (decision 0034). */
  networkRulesDraftChanges: actorScopedProcedure('fleet:network')
    .meta({
      description: [
        "Needs fleet:network. What applying the fleet's draft would change (decision 0034): per verb, the pairs of ships you read that the draft lets one reach the other and the applied rules do not (gained, with the draft's rule), and the other way (lost, with the applied rule).",
        'A fleet without a draft is NOT_FOUND.',
      ].join(' '),
    })
    .output(networkRulesDraftChangesOutputSchema)
    .query(async ({ ctx }) => okOrThrow(await ctx.useCases.readNetworkRulesDraftChanges(ctx.caller))),

  /** Applies the draft: its rules are in force from now on (decision 0034). */
  applyNetworkRules: actorScopedProcedure('fleet:network')
    .meta({
      description: [
        "Needs fleet:network. Applies the fleet's draft: its rules are the ones in force from now on, and the draft goes (decision 0034). Every send, read and manage is checked against the applied rules, never the draft.",
        'Name the settings version you saw the draft against (fleet_networkRules): once the settings moved, the apply is CONFLICT and the draft stays, so you look at what it changes again. A fleet without a draft is NOT_FOUND. Answers the new version.',
      ].join(' '),
    })
    .input(applyNetworkRulesInputSchema)
    .output(networkVersionOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.applyNetworkRules(ctx.caller, input))),

  /** The applied rules and the labels they use, by name, as one file (design network-io, section 4). */
  exportNetworkRules: actorScopedProcedure('fleet:network')
    .meta({
      description: [
        "Needs fleet:network. The fleet's applied network rules, never the draft, as one network rules file: every id by name, a label value by its key and value, a label by its key, an owner's ship by its name, beside the labels the rules use with their values and definers.",
        'It carries the format aeolus.network-rules, its version, when it was exported, the fleet and the settings version of the rules, to tell two files apart. Rules of null are none applied, all-to-all. A rule on a label or ship the fleet no longer has matches no ship: it is left out, and leftOut names it by its place in the applied list, with why. Bring the file back with fleet_importNetworkRules, into this fleet or another.',
      ].join(' '),
    })
    .output(exportNetworkRulesOutputSchema)
    .query(async ({ ctx }) => okOrThrow(await ctx.useCases.exportNetworkRules(ctx.caller))),

  /**
   * The file checked before an import: what it holds and where the fleet
   * differs (design network-io, section 5). A mutation though it reads only,
   * as the file of up to 64 KB travels in the body, never in a query's URL.
   */
  checkNetworkRulesFile: actorAllScopesProcedure('fleet:network', 'labels:define')
    .meta({
      description: [
        'Needs fleet:network and labels:define. Checks a network rules file, as fleet_exportNetworkRules writes it, given as its text: its format, version, shape and limits. A file that breaks is INVALID_NETWORK_RULES_FILE naming each break; another version is refused, never migrated.',
        'Answers the file, the label keys import would define, and the differences with this fleet, each with the ways to resolve it: a key the fleet has with another definer (useExisting or dropRules on it), with other values (useExisting when it has every value the rules name, else dropRules naming a value it lacks), or an owner ship name no active ship has (pickShip or dropRules). It changes nothing.',
      ].join(' '),
    })
    .input(checkNetworkRulesFileInputSchema)
    .output(checkNetworkRulesFileOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.checkNetworkRulesFile(ctx.caller, input))),

  /** Imports a network rules file into the draft (design network-io, section 5). */
  importNetworkRules: actorAllScopesProcedure('fleet:network', 'labels:define')
    .meta({
      description: [
        'Needs fleet:network and labels:define. Imports a network rules file into the draft of the fleet\'s own rules, in place of the draft before: give its text, a resolution for every difference fleet_checkNetworkRulesFile answered, by its kind and key or ship name and one of its ways (pickShip names the ship by shipId), and the definer of the labels the fleet lacks, argo when you name none, or an active ship within your manage reach.',
        'In one unit of work the fleet is checked again: a difference without a resolution is LABEL_DIFFERENCES and nothing is written. The missing labels are defined for the definer, and the rules, by ids, are the draft; nothing is in force until fleet_applyNetworkRules applies it. Answers the settings version the draft was saved against and the keys it defined.',
      ].join(' '),
    })
    .input(importNetworkRulesInputSchema)
    .output(importNetworkRulesOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.importNetworkRules(ctx.caller, input))),

  /** A built-in rule turned on or off: the viewer reading, by any actor holding fleet:network (decision 0034). */
  setBuiltInRule: actorScopedProcedure('fleet:network')
    .meta({
      description: [
        'Needs fleet:network. Turns a built-in network rule on or off, as its own action with BuiltInRuleChanged (decision 0034).',
        'viewerRead lets the viewer read every ship, and is the one you turn. open lets every ship reach every ship by every verb: it is on exactly while the fleet has no rules applied, so turning it is refused. argo, owner, answer, pluginRead and installation are never off: turning them is refused. A rule already as asked changes nothing. Answers the version.',
      ].join(' '),
    })
    .input(setBuiltInRuleInputSchema)
    .output(networkVersionOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.setBuiltInRule(ctx.caller, input))),

  /** Every built-in rule as it is now, for argo's rule list, which shows them first (decision 0034). */
  builtInRules: actorScopedProcedure('fleet:network')
    .output(builtInRulesOutputSchema)
    .query(async ({ ctx }) => okOrThrow(await ctx.useCases.readBuiltInRules(ctx.caller))),

  /** The caller declares the network rules it needs on the labels it owns, its whole list (decision 0037). */
  declareNetworkRules: actorScopedProcedure('labels:define')
    .meta({
      description: [
        'Needs labels:define. Declares the network rules your ship, or the installation, needs, the whole list at once, replacing what you declared before; an empty list withdraws them (decision 0037; the installation, decision 0052). An account owns no label, so it declares none.',
        'Every term of every rule must be on a label you own: a label value id of it, or { labelId, value: "*" } or { labelId, value: "#" } on it; a label or value the fleet does not have is refused.',
        'You declare at most 20 rules, each as fleet_saveNetworkRulesDraft takes them but without a term of the owner, which is on no label. Declared rules are in force beside the fleet\'s own once it has rules applied; while it has none, open lets every ship reach every ship anyway. Answers how many rules you declare now.',
      ].join(' '),
    })
    .input(declareNetworkRulesInputSchema)
    .output(declareNetworkRulesOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.declareNetworkRules(ctx.caller, input))),

  /** Every declarer's declared rules, in force beside the fleet's own (decisions 0037, 0052). */
  declaredNetworkRules: actorScopedProcedure('fleet:network')
    .meta({
      description: [
        'Needs fleet:network. The network rules the fleet\'s ships and the installation declared on the labels they own, each ship or the installation as declarer with its whole list (decision 0037; the installation, decision 0052).',
        'They are in force beside the fleet\'s own rules, read with fleet_networkRules.',
      ].join(' '),
    })
    .output(declaredNetworkRulesOutputSchema)
    .query(async ({ ctx }) =>
      (await ctx.useCases.readDeclaredNetworkRules(ctx.caller)).map(({ declarer, rules }) => ({ declarer, rules: rules.map((rule) => ({ verb: rule.verb, from: [...rule.from], to: [...rule.to] })) })),
    ),

  /** A page of the sends the network rules refused, newest first, of the ships the caller reads (decisions 0034, 0053). */
  reachRefusals: actorScopedProcedure('fleet:explain')
    .input(reachRefusalsInputSchema)
    .output(reachRefusalsOutputSchema)
    .query(async ({ ctx, input }) => {
      const { items, nextCursor } = okOrThrow(await ctx.useCases.readReachRefusals(ctx.caller, input));
      return {
        items: items.map(({ id, at, sender, askedBy, recipient, verb, settingsVersion }) => ({
          id,
          at: at.toISOString(),
          sender: refusedActorOutputOf(sender),
          askedBy: askedBy && { ...askedBy, labels: [...askedBy.labels] },
          recipient:
            recipient.kind === 'ship'
              ? { kind: recipient.kind, ship: { ...recipient.ship, labels: [...recipient.ship.labels] } }
              : { kind: recipient.kind, type: recipient.type, ships: recipient.ships.map((ship) => ({ ...ship, labels: [...ship.labels] })) },
          verb,
          settingsVersion,
        })),
        nextCursor,
      };
    }),

  /** Which ships a ship the caller reads reaches now, or whether it reaches one (design on #260, decision 0053). */
  explainReach: actorScopedProcedure('fleet:explain')
    .input(explainReachInputSchema)
    .output(explainReachOutputSchema)
    .query(async ({ ctx, input }) => okOrThrow(await ctx.useCases.explainReach(ctx.caller, input))),

  /** One ship of the fleet, retired ones included, with when it was commissioned, crewed and retired. */
  ship: actorAnyScopeProcedure('fleet:read', 'crew:run')
    .meta({
      description: [
        'Needs fleet:read, or crew:run for a ship whose crew request is assigned to yours. One ship of the fleet, retired ones included: as fleet_list shows it, plus when it was commissioned, crewed and retired, its open and in-flight deliveries, and its statement as discover shows it (decision 0047).',
        'A ship outside your read reach, and not assigned to yours, shows its id, name, type and status only, with isInReadReach false (decision 0034).',
      ].join(' '),
    })
    .input(shipInputSchema)
    .output(shipOutputSchema)
    .query(async ({ ctx, input }) => {
      const ship = okOrThrow(await ctx.useCases.getShip(ctx.caller, input));
      if (!isInReadReach(ship)) {
        return ship;
      }
      return {
        ...ship,
        startingPrompt: ship.startingPrompt && {
          issuedAt: ship.startingPrompt.issuedAt.toISOString(),
          isClaimed: ship.startingPrompt.isClaimed,
        },
        lastSeenAt: ship.lastSeenAt?.toISOString() ?? null,
        ping: pingOutputOf(ship.ping),
        scopes: [...ship.scopes],
        labels: [...ship.labels],
        report: ship.report && { ...ship.report, reportedAt: ship.report.reportedAt.toISOString() },
        crewRequest: crewRequestOutputOf(ship.crewRequest),
        model: ship.model && { id: ship.model.id, statedAt: ship.model.statedAt.toISOString() },
        awaitingCrewSince: ship.awaitingCrewSince?.toISOString() ?? null,
        commissionedAt: ship.commissionedAt.toISOString(),
        crewedSince: ship.crewedSince?.toISOString() ?? null,
        retiredAt: ship.retiredAt?.toISOString() ?? null,
      };
    }),

  /** The ships counted per kind: the overview's cards and subtitle, and the navigation's needs-crew count. */
  shipCounts: actorScopedProcedure('fleet:read')
    .input(shipCountsInputSchema)
    .output(shipCountsOutputSchema)
    .query(async ({ ctx, input }) =>
      (await ctx.useCases.countShips(ctx.caller, { filter: input?.filter })).map(({ longestWait, ...counts }) => ({
        ...counts,
        longestWait: longestWait && { ...longestWait, awaitingCrewSince: longestWait.awaitingCrewSince.toISOString() },
      })),
    ),

  /** The types of the ships in read reach, each once, sorted: active ones unless status asks for retired. */
  shipTypes: actorScopedProcedure('fleet:read')
    .input(shipTypesInputSchema)
    .output(shipTypesOutputSchema)
    .query(({ ctx, input }) => ctx.useCases.listShipTypes(ctx.caller, { status: input?.status })),

  /** One ship exactly as fleet_list lists it, retired ones included: what a change to that ship reloads. */
  listedShip: actorScopedProcedure('fleet:read')
    .input(shipInputSchema)
    .output(listedShipOutputSchema)
    .query(async ({ ctx, input }) => {
      const ship = okOrThrow(await ctx.useCases.readListedShip(ctx.caller, input));
      return isInReadReach(ship) ? listedShipOutputOf(ship) : ship;
    }),

  /** A page of every change to a ship, newest first: the events naming it and the ones it caused. */
  shipTimeline: actorScopedProcedure('fleet:read')
    .input(shipTimelineInputSchema)
    .output(shipTimelineOutputSchema)
    .query(async ({ ctx, input }) => {
      const { items, nextCursor } = okOrThrow(await ctx.useCases.readShipTimeline(ctx.caller, input));
      return { items: items.map((entry) => ({ ...entry, occurredAt: entry.occurredAt.toISOString() })), nextCursor };
    }),

  /** A page of the messages a ship sent, was sent, or claimed as a ship of their type, newest first. */
  shipMessages: actorScopedProcedure('fleet:read')
    .input(shipMessagesInputSchema)
    .output(shipMessagesOutputSchema)
    .query(async ({ ctx, input }) => {
      const { items, nextCursor } = okOrThrow(await ctx.useCases.readShipMessages(ctx.caller, input));
      return { items: items.map((message) => ({ ...message, sentAt: message.sentAt.toISOString() })), nextCursor };
    }),

  /** One message: envelope, payload, its replies, its delivery's way through with every step, newest first, and how many deliveries it has. */
  message: actorScopedProcedure('fleet:read')
    .input(messageInputSchema)
    .output(messageOutputSchema)
    .query(async ({ ctx, input }) => {
      const message = okOrThrow(await ctx.useCases.readMessage(ctx.caller, input));
      return {
        ...message,
        sentAt: message.sentAt.toISOString(),
        replies: message.replies.map((reply) => ({ ...reply, sentAt: reply.sentAt.toISOString() })),
        delivery: {
          ...message.delivery,
          way: wayOutputOf(message.delivery.way),
          history: message.delivery.history.map((change) => ({ ...change, occurredAt: change.occurredAt.toISOString() })),
        },
      };
    }),

  /** A page of a message's deliveries by id, each with its ship, state and since when: one per ship for a label. */
  messageDeliveries: actorScopedProcedure('fleet:read')
    .input(messageDeliveriesInputSchema)
    .output(messageDeliveriesOutputSchema)
    .query(async ({ ctx, input }) => {
      const { items, nextCursor } = okOrThrow(await ctx.useCases.readMessageDeliveries(ctx.caller, input));
      return { items: items.map((delivery) => ({ ...delivery, since: delivery.since.toISOString() })), nextCursor };
    }),

  /** A ship's side of the way: the part that serves its lease, its turn, and its oldest delivery waiting with its way. */
  shipWay: actorScopedProcedure('fleet:read')
    .input(shipInputSchema)
    .output(shipWayOutputSchema)
    .query(async ({ ctx, input }) => {
      const { lease, waiting, oldest } = okOrThrow(await ctx.useCases.readShipWay(ctx.caller, input));
      return {
        lease: lease && { by: lease.by, turn: lease.turn && { turn: lease.turn.state, at: lease.turn.at.toISOString() } },
        waiting,
        oldest: oldest && {
          ...oldest,
          sentAt: oldest.sentAt.toISOString(),
          delivery: { ...oldest.delivery, way: wayOutputOf(oldest.delivery.way) },
        },
      };
    }),

  /** Needs attention: a page of the undeliverable or not handled deliveries of the fleet or one ship, oldest first, with their whole message. */
  needsAttention: actorScopedProcedure('fleet:read')
    .input(needsAttentionInputSchema)
    .output(needsAttentionOutputSchema)
    .query(async ({ ctx, input }) => {
      const { items, nextCursor } = okOrThrow(await ctx.useCases.readNeedsAttention(ctx.caller, input));
      return {
        items: items.map((entry) => ({
          ...entry,
          since: entry.since.toISOString(),
          message: { ...entry.message, ...listedPayloadOutputOf(entry.message.payload), sentAt: entry.message.sentAt.toISOString() },
        })),
        nextCursor,
      };
    }),

  /** The fleet's health (decision 0042): its stuck deliveries by cause and place, the 7-day trend and the acknowledged in 24 hours. */
  health: actorScopedProcedure('fleet:read')
    .output(fleetHealthOutputSchema)
    .query(async ({ ctx }) => {
      const { keyUnavailable, ...health } = await ctx.useCases.readHealth(ctx.caller);
      return { ...describedHealth(health), keyUnavailable: keyUnavailable && { ...keyUnavailable, since: keyUnavailable.since.toISOString() } };
    }),

  /** How many deliveries are stuck now and since when the oldest waits: the navigation's count and the overview's card. */
  stuckCount: actorScopedProcedure('fleet:read')
    .output(stuckCountOutputSchema)
    .query(async ({ ctx }) => {
      const { count, oldestSince } = await ctx.useCases.readStuckCount(ctx.caller);
      return { count, oldestSince: oldestSince?.toISOString() ?? null };
    }),

  /** A page of the deliveries stuck now by cause and place (decision 0042), each ship with the machine behind it: Health's causes and machines. */
  stuck: actorScopedProcedure('fleet:read')
    .input(stuckInputSchema)
    .output(stuckOutputSchema)
    .query(async ({ ctx, input }) => {
      const { cursor, ...page } = input;
      const { items, nextCursor } = await ctx.useCases.readStuck(ctx.caller, { ...page, ...(cursor && { cursor: { ...cursor, oldestSince: new Date(cursor.oldestSince) } }) });
      return { items: describedStuck(items), nextCursor: nextCursor && { ...nextCursor, oldestSince: nextCursor.oldestSince.toISOString() } };
    }),

  /** How many deliveries are stuck now and in how many places, in all, per cause and per machine: Health's verdict, cause totals and machines. */
  stuckSummary: actorScopedProcedure('fleet:read')
    .output(stuckSummaryOutputSchema)
    .query(async ({ ctx }) => {
      const { oldestSince, ...summary } = await ctx.useCases.readStuckSummary(ctx.caller);
      return { ...summary, oldestSince: oldestSince?.toISOString() ?? null };
    }),

  /** How many deliveries were stuck at each hour of the last 7 days, the last one now: Health's trend. */
  stuckHistory: actorScopedProcedure('fleet:read')
    .output(stuckPerHourSchema)
    .query(async ({ ctx }) => describedPerHour(await ctx.useCases.readStuckHistory(ctx.caller))),

  /** The deliveries acknowledged in the last 24 hours, with the median from send to acknowledgement: Health's delivering line. */
  acknowledged: actorScopedProcedure('fleet:read')
    .output(acknowledgedSchema)
    .query(async ({ ctx }) => describedAcknowledged(await ctx.useCases.readAcknowledged(ctx.caller))),

  /** Lets an undeliverable or not handled delivery go: dismissed, kept in history. Dismissing it again is OK. */
  dismiss: actorScopedProcedure('messages:resend')
    .input(dismissDeliveryInputSchema)
    .output(dismissDeliveryOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.dismissDelivery(ctx.caller, input));
      return {};
    }),

  /**
   * Sends an undeliverable or not handled delivery again: a new message from the same sender
   * to the same recipient that names the original, which is dismissed.
   * Answers the new message; a second resend of the delivery answers the same.
   */
  resend: actorScopedProcedure('messages:resend')
    .input(resendDeliveryInputSchema)
    .output(resendDeliveryOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.resendDelivery(ctx.caller, input))),

  /** A page of the caller's inbox, argo's for the console: the messages to it the filter keeps, newest first. */
  inbox: actorScopedProcedure('fleet:read')
    .input(operatorInboxInputSchema)
    .output(operatorInboxOutputSchema)
    .query(async ({ ctx, input }) => {
      const { items, nextCursor } = okOrThrow(await ctx.useCases.readInbox(ctx.caller, input));
      return { items: items.map(inboxEntryOutputOf), nextCursor };
    }),

  /** One message to the caller's inbox, argo's for the console, by its delivery, as `inbox` lists it. */
  inboxMessage: actorScopedProcedure('fleet:read')
    .input(inboxMessageInputSchema)
    .output(inboxMessageSchema)
    .query(async ({ ctx, input }) => inboxEntryOutputOf(okOrThrow(await ctx.useCases.readInboxMessage(ctx.caller, input)))),

  /** A page of the messages to the caller's inbox, argo's for the console, that withdraw or replace a question, oldest first. */
  inboxWithdrawals: actorScopedProcedure('fleet:read')
    .input(inboxWithdrawalsInputSchema)
    .output(operatorInboxOutputSchema)
    .query(async ({ ctx, input }) => {
      const { items, nextCursor } = okOrThrow(await ctx.useCases.readInboxWithdrawals(ctx.caller, input));
      return { items: items.map(inboxEntryOutputOf), nextCursor };
    }),

  /** How many messages to the caller's inbox, argo's for the console, are open: counted in one query. */
  inboxCount: actorScopedProcedure('fleet:read')
    .output(inboxCountOutputSchema)
    .query(({ ctx }) => ctx.useCases.countOpenInbox(ctx.caller)),

  /** Marks a message to argo read, as opening it does, or unread again. Read is not done. */
  markRead: scopedCrewCallerProcedure('messages:receive')
    .input(markReadInputSchema)
    .output(inboxActionOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.markRead(ctx.crew, input));
      return {};
    }),

  /** Marks a message to argo done without a reply: acknowledged under the console session's lease. */
  markDone: scopedCrewCallerProcedure('messages:receive')
    .input(markDoneInputSchema)
    .output(inboxActionOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.markDone(ctx.crew, input));
      return {};
    }),

  /** Replies to a message to argo, as plain text unless it says another content type, to its sender, and marks it done, in one transaction. */
  reply: scopedCrewCallerProcedure('messages:send', 'messages:receive')
    .input(replyInputSchema)
    .output(replyOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.replyToMessage(ctx.crew, input))),

  /**
   * The fleet's committed events after a position, for a client that is no
   * browser: the same numbers the live stream sends, waiting up to
   * waitSeconds while none has come. A query: it changes nothing.
   */
  follow: actorScopedProcedure('fleet:read')
    .meta({
      description: [
        'Needs fleet:read. The fleet\'s events after afterSeq, oldest first, up to max (1 to 100, 100 when left out):',
        'each with its seq, type, time, the ship that caused it and the ship, message and delivery it concerns, never its details. Only the events in your read reach (decision 0034): a message\'s through its sender or recipient, any other through the ship it concerns.',
        'Pass the lastSeq it answers as afterSeq next, so you miss nothing across reconnects: it counts the events you do not read too.',
        'Without afterSeq it answers no events and the current lastSeq to start from.',
        'With waitSeconds (0 to 25) it waits while none has come, and answers as soon as one commits.',
      ].join(' '),
    })
    .input(followFleetInputSchema)
    .output(followFleetOutputSchema)
    .query(async ({ ctx, input }) => {
      const { events, lastSeq } = okOrThrow(await ctx.useCases.followFleet(ctx.caller, input ?? {}));
      return { events: events.map(liveEventOf), lastSeq };
    }),

  /**
   * The fleet's committed events, live, over the WebSocket: each with its
   * number, which tRPC sends back as `lastEventId` when the browser
   * reconnects, so it misses none. Without a number, or too far behind, the
   * browser is told to load the fleet again first (`resync`). Each wake-up
   * asks again whether the caller still holds, with fleet:read and, reading on
   * behalf, fleet:on-behalf, so a session that ended or a revoked scope hears
   * no more.
   */
  events: actorScopedProcedure('fleet:read')
    .input(fleetEventsInputSchema)
    .subscription(async function* ({ ctx, input, signal }): AsyncGenerator<TrackedEnvelope<FleetStreamItem>> {
      const watch = ctx.fleetEvents.watch(ctx.caller.fleetId);
      const stopped = signal ?? new AbortController().signal;
      try {
        let afterSeq = input.lastEventId == null ? undefined : Number(input.lastEventId);
        let reader = ctx.caller;
        do {
          const read = await ctx.useCases.readFleetEvents(reader, afterSeq);
          if (read.kind === 'resync') {
            afterSeq = read.seq;
            yield tracked(String(read.seq), { kind: 'resync' } satisfies FleetStreamItem);
          } else {
            for (const event of read.events) {
              yield tracked(String(event.seq), { kind: 'event', event: liveEventOf(event) } satisfies FleetStreamItem);
            }
            afterSeq = read.lastSeq;
          }
          if (!(await watch.next(stopped))) {
            return;
          }
          reader = await callerStillHolding(ctx, 'fleet:read');
        } while (!stopped.aborted);
      } finally {
        watch.stop();
      }
    }),
});

/** A ship as fleet_list answers it, its times in ISO 8601. */
function listedShipOutputOf(ship: ListedShip) {
  return {
    ...ship,
    startingPrompt: ship.startingPrompt && {
      issuedAt: ship.startingPrompt.issuedAt.toISOString(),
      isClaimed: ship.startingPrompt.isClaimed,
    },
    lastSeenAt: ship.lastSeenAt?.toISOString() ?? null,
    ping: pingOutputOf(ship.ping),
    scopes: [...ship.scopes],
    labels: [...ship.labels],
    report: ship.report && { ...ship.report, reportedAt: ship.report.reportedAt.toISOString() },
    crewRequest: crewRequestOutputOf(ship.crewRequest),
    model: ship.model && { id: ship.model.id, statedAt: ship.model.statedAt.toISOString() },
    awaitingCrewSince: ship.awaitingCrewSince?.toISOString() ?? null,
    retiredAt: ship.retiredAt?.toISOString() ?? null,
  };
}

/** Who a refusal refused, as `fleet.reachRefusals` answers it: an account by its id only (decision 0057). */
/** The fleet's own rules as the output carries them, none for all-to-all. */
function rulesOutputOf(rules: readonly NetworkRule[] | null) {
  return rules === null ? null : rules.map((rule) => ({ verb: rule.verb, from: [...rule.from], to: [...rule.to] }));
}

function refusedActorOutputOf(actor: RefusedActor) {
  return actor.kind === 'installation' ? actor : { ...actor, labels: [...actor.labels] };
}

/** An event as the browser hears it: never its details. */
function liveEventOf(event: SequencedEvent) {
  return {
    seq: event.seq,
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    actorKind: event.actor.kind,
    actorShipId: event.actor.kind === 'ship' ? event.actor.shipId : null,
    actorAccountId: event.actor.kind === 'account' ? event.actor.accountId : null,
    actorSignedInAccountId: event.actor.kind === 'ship' ? (event.actor.signedInAccountId ?? null) : null,
    shipId: event.shipId ?? null,
    messageId: event.messageId ?? null,
    deliveryId: event.deliveryId ?? null,
  };
}

function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
