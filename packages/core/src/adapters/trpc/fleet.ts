import {
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
  messageInputSchema,
  messageOutputSchema,
  needsAttentionOutputSchema,
  operatorInboxInputSchema,
  operatorInboxOutputSchema,
  pingShipInputSchema,
  pingShipOutputSchema,
  shipDetailOutputSchema,
  shipInputSchema,
  shipMessagesOutputSchema,
  shipTimelineOutputSchema,
  type FleetStreamItem,
  getStartingPromptInputSchema,
  recrewShipInputSchema,
  releaseShipInputSchema,
  releaseShipOutputSchema,
  assignCrewInputSchema,
  assignCrewOutputSchema,
  assignedCrewRequestsOutputSchema,
  confirmCrewReleaseInputSchema,
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
  defineLabelInputSchema,
  defineLabelOutputSchema,
  deleteLabelInputSchema,
  findLabelValueInputSchema,
  findLabelValueOutputSchema,
  fleetListInputSchema,
  labelWriteOutputSchema,
  labelsOutputSchema,
  unassignLabelInputSchema,
} from '@aeolus-fleet/common';
import { tracked, type TrackedEnvelope } from '@trpc/server';
// The subscription's output type names TrackedData, which tRPC exports only
// here; the declarations the build emits need a path to reach it by.
import type {} from '@trpc/server/unstable-core-do-not-import';

import type { PingStatus } from '../../domain/registry/ping-status.js';
import type { SequencedEvent } from '../../domain/shared/events.js';
import { presentStartingPrompt } from './starting-prompt-text.js';
import { anyScopeProcedure, checkCallerStillHolds, okOrThrow, router, scopedCrewCallerProcedure, scopedProcedure } from './trpc.js';

/** A crew request as the API answers it: its times in ISO 8601, and when its session started as `startedAt`. */
function crewRequestOutputOf<T extends { requestedAt: Date; sessionStartedAt: Date | null }>(request: T | null) {
  if (request === null) {
    return null;
  }
  const { sessionStartedAt, ...rest } = request;
  return { ...rest, requestedAt: request.requestedAt.toISOString(), startedAt: sessionStartedAt?.toISOString() ?? null };
}

/** A ship's last ping as the API states it: its dates in ISO 8601. */
function pingOutputOf(ping: PingStatus | null) {
  return ping && { state: ping.state, sentAt: ping.sentAt.toISOString(), answeredAt: ping.answeredAt?.toISOString() ?? null };
}

/**
 * Fleet procedures: commission ships, hand out their starting prompts, release
 * them, list the fleet and follow it live, read a ship's page (the ship, its
 * timeline, its messages and one message's delivery history), and Needs
 * attention: the undeliverable deliveries, resent or dismissed, and argo's
 * inbox: the messages to it, read, marked done or replied to. The caller's
 * fleet and ship come from its credentials, never from the input.
 */
export const fleetRouter = router({
  /** A new agent ship awaiting crew, and its first starting prompt: shown once. */
  commission: scopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. Commissions a new agent ship awaiting crew: name and type are handles (lowercase letters, digits, hyphens, colons).',
        'fleetScopes adds fleet:read and/or fleet:manage to its scopes; they never change later.',
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
  getStartingPrompt: anyScopeProcedure('fleet:manage', 'crew:run')
    .meta({
      description: [
        'Needs fleet:manage, or crew:run for a ship whose crew request is assigned to yours. A new starting prompt, one crew line per harness and the secret for a ship awaiting crew; its new secret stops any earlier one working.',
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
  ping: scopedProcedure('fleet:manage')
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
  release: anyScopeProcedure('fleet:manage', 'crew:run')
    .meta({
      description: [
        'Needs fleet:manage, or crew:run for a ship whose crew request is assigned to yours. Frees a crewed ship from its session: its crew token and secret stop working, and what it held in flight returns to pending.',
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
  retire: scopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. Ends a ship permanently, never argo: its lease and secret end and its direct deliveries are abandoned.',
        'Answers how many it abandoned.',
      ].join(' '),
    })
    .input(retireShipInputSchema)
    .output(retireShipOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.retireShip(ctx.caller, input))),

  /**
   * Asks that a ship be kept crewed, with settings stored without meaning,
   * replacing any request it holds (decision 0029).
   */
  crewRequest: scopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. Asks that a ship be kept crewed, with settings: one JSON object of at most 16 KB (harness, workspace, options,',
        'an optional first prompt and squadron), stored without meaning. Replaces the settings of a request the ship holds.',
        'Never argo, the viewer or a retired ship. Answers the settings version, one more on every request.',
      ].join(' '),
    })
    .input(crewRequestInputSchema)
    .output(crewRequestOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.requestCrew(ctx.caller, input))),

  /** Removes a ship's crew request; its crew, if any, stays aboard. */
  removeCrewRequest: scopedProcedure('fleet:manage')
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
  assignCrew: scopedProcedure('crew:assign')
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
  explainCrewRequest: scopedProcedure('crew:assign')
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

  /** The crew requests assigned to the caller's ship: a trierarch's ships. */
  assignedCrewRequests: scopedProcedure('crew:run')
    .meta({
      description: ['Needs crew:run. The crew requests assigned to your ship, oldest ship first: each ship, its settings and their version, and its status.'].join(
        ' ',
      ),
    })
    .output(assignedCrewRequestsOutputSchema)
    .query(async ({ ctx }) =>
      (await ctx.useCases.readAssignedCrewRequests(ctx.caller)).map((request) => ({ ...request, requestedAt: request.requestedAt.toISOString() })),
    ),

  /**
   * Gives a ship a new name, any ship but argo or a retired one. Its id,
   * history and session stay; a sender addressing the old name no longer
   * reaches it.
   */
  rename: scopedProcedure('fleet:manage')
    .input(renameShipInputSchema)
    .output(renameShipOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.renameShip(ctx.caller, input));
      return {};
    }),

  /**
   * A new crew for a crewed ship whose session is gone: a release and a new
   * starting prompt in one transaction. Its prompt, crew lines and secret are shown once.
   */
  recrew: scopedProcedure('fleet:manage')
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
   * The fleet's ship and daily message limits with what each counts, and when
   * today's message count starts again: what the console shows at a limit.
   */
  limits: scopedProcedure('fleet:read')
    .meta({
      description: [
        "Needs fleet:read. The fleet's ship limit with its ships that are not retired (argo included), and its daily message limit with the messages it stored since 00:00 UTC and when that count starts again. A limit of null is none.",
      ].join(' '),
    })
    .output(fleetLimitsOutputSchema)
    .query(async ({ ctx }) => {
      const { ships, dailyMessages } = await ctx.useCases.readFleetLimits(ctx.caller);
      return { ships, dailyMessages: { ...dailyMessages, resetsAt: dailyMessages.resetsAt.toISOString() } };
    }),

  /** Every ship of the caller's fleet with its status and prompt state, or the ships that carry the label values given. Never a secret. */
  list: scopedProcedure('fleet:read')
    .meta({
      description: [
        'Needs fleet:read. Every ship of the fleet, argo included: id, name, type, kind, status, scopes, labels, where its session runs and in which harness, when it was last seen, its last ping, and its current model (the last its sessions stated). Never a secret.',
        'With valueIds (label value ids, from fleet_labels or fleet_findLabelValue), only the ships that carry every one of them: exact matches, combined with AND.',
      ].join(' '),
    })
    .input(fleetListInputSchema)
    .output(fleetListOutputSchema)
    .query(async ({ ctx, input }) =>
      (await ctx.useCases.listFleet(ctx.caller, { valueIds: input?.valueIds })).map((ship) => ({
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
      })),
    ),

  /** The fleet's labels, each with its values and its owner (decision 0031). */
  labels: scopedProcedure('fleet:read')
    .meta({
      description: ["Needs fleet:read. The fleet's labels by key: each with its id, its values with their ids, and its owner ship, by id and name."].join(' '),
    })
    .output(labelsOutputSchema)
    .query(async ({ ctx }) => (await ctx.useCases.listLabels(ctx.caller)).map((label) => ({ ...label, values: [...label.values] }))),

  /** Defines a label the caller's ship then owns (decision 0031). */
  defineLabel: scopedProcedure('labels:define')
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
  changeLabelValues: scopedProcedure('labels:define')
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
  assignLabel: scopedProcedure('labels:assign')
    .meta({
      description: [
        "Needs labels:assign, and only the label's owner assigns it. Gives a ship one of its values, by the value's id, beside the values the ship carries.",
        'Never your own ship or a retired one. A ship carries at most 20 label values (decision 0031).',
      ].join(' '),
    })
    .input(assignLabelInputSchema)
    .output(labelWriteOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.assignLabel(ctx.caller, input));
      return {};
    }),

  /** The owner takes its label off a ship. */
  unassignLabel: scopedProcedure('labels:assign')
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
  deleteLabel: scopedProcedure('labels:define')
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
  findLabelValue: scopedProcedure('fleet:read')
    .meta({
      description: [
        'Needs fleet:read. The label id and the value id for a key and a value as people write them (os, macos): both lowercased, then matched exactly.',
        'Assigning and selecting take the ids. A key or value the fleet does not have is NOT_FOUND.',
      ].join(' '),
    })
    .input(findLabelValueInputSchema)
    .output(findLabelValueOutputSchema)
    .query(async ({ ctx, input }) => okOrThrow(await ctx.useCases.findLabelValue(ctx.caller, input))),

  /** One ship of the fleet, retired ones included, with when it was commissioned, crewed and retired. */
  ship: anyScopeProcedure('fleet:read', 'crew:run')
    .meta({
      description: [
        'Needs fleet:read, or crew:run for a ship whose crew request is assigned to yours. One ship of the fleet, retired ones included: as fleet_list shows it, plus when it was commissioned, crewed and retired, and its open and in-flight deliveries.',
      ].join(' '),
    })
    .input(shipInputSchema)
    .output(shipDetailOutputSchema)
    .query(async ({ ctx, input }) => {
      const ship = okOrThrow(await ctx.useCases.getShip(ctx.caller, input));
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

  /** Every change to a ship, newest first: the events naming it and the ones it caused. */
  shipTimeline: scopedProcedure('fleet:read')
    .input(shipInputSchema)
    .output(shipTimelineOutputSchema)
    .query(async ({ ctx, input }) =>
      okOrThrow(await ctx.useCases.readShipTimeline(ctx.caller, input)).map((entry) => ({
        ...entry,
        occurredAt: entry.occurredAt.toISOString(),
      })),
    ),

  /** The messages a ship sent, was sent, or claimed as a ship of their type, newest first. */
  shipMessages: scopedProcedure('fleet:read')
    .input(shipInputSchema)
    .output(shipMessagesOutputSchema)
    .query(async ({ ctx, input }) =>
      okOrThrow(await ctx.useCases.readShipMessages(ctx.caller, input)).map((message) => ({
        ...message,
        sentAt: message.sentAt.toISOString(),
      })),
    ),

  /** One message: envelope, payload, and its delivery with every change, newest first. */
  message: scopedProcedure('fleet:read')
    .input(messageInputSchema)
    .output(messageOutputSchema)
    .query(async ({ ctx, input }) => {
      const message = okOrThrow(await ctx.useCases.readMessage(ctx.caller, input));
      return {
        ...message,
        sentAt: message.sentAt.toISOString(),
        delivery: {
          ...message.delivery,
          history: message.delivery.history.map((change) => ({ ...change, occurredAt: change.occurredAt.toISOString() })),
        },
      };
    }),

  /** Needs attention: every undeliverable delivery of the fleet, oldest first, with its whole message. */
  needsAttention: scopedProcedure('fleet:read')
    .output(needsAttentionOutputSchema)
    .query(async ({ ctx }) =>
      (await ctx.useCases.readNeedsAttention(ctx.caller)).map((entry) => ({
        ...entry,
        since: entry.since.toISOString(),
        message: { ...entry.message, sentAt: entry.message.sentAt.toISOString() },
      })),
    ),

  /** Lets an undeliverable delivery go: dismissed, kept in history. Dismissing it again is OK. */
  dismiss: scopedProcedure('fleet:manage')
    .input(dismissDeliveryInputSchema)
    .output(dismissDeliveryOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.dismissDelivery(ctx.caller, input));
      return {};
    }),

  /**
   * Sends an undeliverable delivery again: a new message from the same sender
   * to the same recipient that names the original, which is dismissed.
   * Answers the new message; a second resend of the delivery answers the same.
   */
  resend: scopedProcedure('fleet:manage')
    .input(resendDeliveryInputSchema)
    .output(resendDeliveryOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.resendDelivery(ctx.caller, input))),

  /** The caller's inbox, argo's for the console: the messages to it the filter keeps, newest first. */
  inbox: scopedProcedure('fleet:read')
    .input(operatorInboxInputSchema)
    .output(operatorInboxOutputSchema)
    .query(async ({ ctx, input }) =>
      (await ctx.useCases.readInbox(ctx.caller, input)).map((entry) => ({
        ...entry,
        readAt: entry.readAt?.toISOString() ?? null,
        doneAt: entry.doneAt?.toISOString() ?? null,
        message: { ...entry.message, sentAt: entry.message.sentAt.toISOString() },
      })),
    ),

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

  /** Replies to a message to argo as plain text to its sender, and marks it done, in one transaction. */
  reply: scopedCrewCallerProcedure('messages:send', 'messages:receive')
    .input(replyInputSchema)
    .output(replyOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.replyToMessage(ctx.crew, input))),

  /**
   * The fleet's committed events after a position, for a client that is no
   * browser: the same numbers the live stream sends, waiting up to
   * waitSeconds while none has come. A query: it changes nothing.
   */
  follow: scopedProcedure('fleet:read')
    .meta({
      description: [
        'Needs fleet:read. The fleet\'s events after afterSeq, oldest first, up to max (1 to 100, 100 when left out):',
        'each with its seq, type, time, the ship that caused it and the ship, message and delivery it concerns, never its details.',
        'Pass the lastSeq it answers as afterSeq next, so you miss nothing across reconnects.',
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
   * asks again whether the caller still holds, so a console session that ended
   * hears no more.
   */
  events: scopedProcedure('fleet:read')
    .input(fleetEventsInputSchema)
    .subscription(async function* ({ ctx, input, signal }): AsyncGenerator<TrackedEnvelope<FleetStreamItem>> {
      const watch = ctx.fleetEvents.watch(ctx.caller.fleetId);
      const stopped = signal ?? new AbortController().signal;
      try {
        let afterSeq = input.lastEventId == null ? undefined : Number(input.lastEventId);
        do {
          const read = await ctx.useCases.readFleetEvents(ctx.caller, afterSeq);
          if (read.kind === 'resync') {
            afterSeq = read.seq;
            yield tracked(String(read.seq), { kind: 'resync' } satisfies FleetStreamItem);
          } else {
            for (const event of read.events) {
              afterSeq = event.seq;
              yield tracked(String(event.seq), { kind: 'event', event: liveEventOf(event) } satisfies FleetStreamItem);
            }
          }
          if (!(await watch.next(stopped))) {
            return;
          }
          await checkCallerStillHolds(ctx);
        } while (!stopped.aborted);
      } finally {
        watch.stop();
      }
    }),
});

/** An event as the browser hears it: never its details. */
function liveEventOf(event: SequencedEvent) {
  return {
    seq: event.seq,
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    actorShipId: event.actor.kind === 'ship' ? event.actor.shipId : null,
    shipId: event.shipId ?? null,
    messageId: event.messageId ?? null,
    deliveryId: event.deliveryId ?? null,
  };
}
