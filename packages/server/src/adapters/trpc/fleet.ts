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
  renameShipInputSchema,
  renameShipOutputSchema,
  replyInputSchema,
  replyOutputSchema,
  resendDeliveryInputSchema,
  resendDeliveryOutputSchema,
  retireShipInputSchema,
  retireShipOutputSchema,
  startingPromptOutputSchema,
} from '@aeolus-fleet/common';
import { tracked, type TrackedEnvelope } from '@trpc/server';
// The subscription's output type names TrackedData, which tRPC exports only
// here; the declarations the build emits need a path to reach it by.
import type {} from '@trpc/server/unstable-core-do-not-import';

import type { PingStatus } from '../../core/registry/ping-status.js';
import type { SequencedEvent } from '../../core/shared/events.js';
import { checkCallerStillHolds, okOrThrow, router, scopedCrewCallerProcedure, scopedProcedure } from './trpc.js';

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
        'Answers its shipId and its first starting prompt and crew line, shown only this once: they hold its secret.',
        'idempotencyKey is a new unique string for every commission. Reuse one only to retry the same commission after an error or a lost answer:',
        'the retry answers the same shipId with prompt and crewLine null and how its starting prompt stands (fleet_getStartingPrompt gives a new one), and a different commission with a used key is refused (CONFLICT).',
      ].join(' '),
    })
    .input(commissionShipInputSchema)
    .output(commissionShipOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const commissioned = okOrThrow(await ctx.useCases.commissionShip(ctx.caller, input));
      const { startingPrompt } = commissioned;
      return { ...commissioned, startingPrompt: startingPrompt && { ...startingPrompt, issuedAt: startingPrompt.issuedAt.toISOString() } };
    }),

  /** A new starting prompt for a ship awaiting crew. Its secret invalidates the previous one. */
  getStartingPrompt: scopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. A new starting prompt and crew line for a ship awaiting crew; its new secret stops any earlier one working.',
      ].join(' '),
    })
    .input(getStartingPromptInputSchema)
    .output(startingPromptOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.getStartingPrompt(ctx.caller, input))),

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
  release: scopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. Frees a crewed ship from its session: its crew token and secret stop working, and what it held in flight returns to pending.',
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
   * starting prompt in one transaction. Its prompt and crew line are shown once.
   */
  recrew: scopedProcedure('fleet:manage')
    .meta({
      description: [
        'Needs fleet:manage. A new crew for a crewed ship whose session is gone: releases it and answers a fresh starting prompt and crew line, shown once. Never argo.',
      ].join(' '),
    })
    .input(recrewShipInputSchema)
    .output(startingPromptOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.recrewShip(ctx.caller, input))),

  /** Every ship of the caller's fleet with its status and prompt state. Never a secret. */
  list: scopedProcedure('fleet:read')
    .meta({
      description: [
        'Needs fleet:read. Every ship of the fleet, argo included: id, name, type, kind, status, scopes, where its session runs and in which harness, when it was last seen, its last ping, and its current model (the last its sessions stated). Never a secret.',
      ].join(' '),
    })
    .output(fleetListOutputSchema)
    .query(async ({ ctx }) =>
      (await ctx.useCases.listFleet(ctx.caller)).map((ship) => ({
        ...ship,
        startingPrompt: ship.startingPrompt && {
          issuedAt: ship.startingPrompt.issuedAt.toISOString(),
          isClaimed: ship.startingPrompt.isClaimed,
        },
        lastSeenAt: ship.lastSeenAt?.toISOString() ?? null,
        ping: pingOutputOf(ship.ping),
        scopes: [...ship.scopes],
        report: ship.report && { ...ship.report, reportedAt: ship.report.reportedAt.toISOString() },
        model: ship.model && { id: ship.model.id, statedAt: ship.model.statedAt.toISOString() },
      })),
    ),

  /** One ship of the fleet, retired ones included, with when it was commissioned, crewed and retired. */
  ship: scopedProcedure('fleet:read')
    .meta({
      description: [
        'Needs fleet:read. One ship of the fleet, retired ones included: as fleet_list shows it, plus when it was commissioned, crewed and retired, and its open and in-flight deliveries.',
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
        report: ship.report && { ...ship.report, reportedAt: ship.report.reportedAt.toISOString() },
        model: ship.model && { id: ship.model.id, statedAt: ship.model.statedAt.toISOString() },
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
