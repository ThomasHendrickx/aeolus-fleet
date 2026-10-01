import {
  commissionShipInputSchema,
  fleetEventsInputSchema,
  fleetListOutputSchema,
  type FleetStreamItem,
  getStartingPromptInputSchema,
  releaseShipInputSchema,
  releaseShipOutputSchema,
  startingPromptOutputSchema,
} from '@aeolus-fleet/common';
import { tracked } from '@trpc/server';

import type { SequencedEvent } from '../../core/shared/events.js';
import { checkCallerStillHolds, okOrThrow, router, scopedProcedure } from './trpc.js';

/**
 * Fleet procedures: commission ships, hand out their starting prompts, release
 * them, list the fleet and follow it live. The caller's fleet and ship come from its credentials, never from
 * the input.
 */
export const fleetRouter = router({
  /** A new agent ship awaiting crew, and its first starting prompt: shown once. */
  commission: scopedProcedure('fleet:manage')
    .input(commissionShipInputSchema)
    .output(startingPromptOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.commissionShip(ctx.caller, input))),

  /** A new starting prompt for a ship awaiting crew. Its secret invalidates the previous one. */
  getStartingPrompt: scopedProcedure('fleet:manage')
    .input(getStartingPromptInputSchema)
    .output(startingPromptOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.getStartingPrompt(ctx.caller, input))),

  /**
   * Frees a crewed ship from the session crewing it: its crew token and secret
   * stop working, and what it held in flight returns to pending for the next
   * crew. Never argo; a ship awaiting crew gets a new starting prompt instead.
   */
  release: scopedProcedure('fleet:manage')
    .input(releaseShipInputSchema)
    .output(releaseShipOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.releaseShip(ctx.caller, input));
      return {};
    }),

  /** Every ship of the caller's fleet with its status and prompt state. Never a secret. */
  list: scopedProcedure('fleet:read')
    .output(fleetListOutputSchema)
    .query(async ({ ctx }) =>
      (await ctx.useCases.listFleet(ctx.caller)).map((ship) => ({
        ...ship,
        startingPrompt: ship.startingPrompt && {
          issuedAt: ship.startingPrompt.issuedAt.toISOString(),
          isClaimed: ship.startingPrompt.isClaimed,
        },
      })),
    ),

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
    .subscription(async function* ({ ctx, input, signal }) {
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
    shipId: event.shipId ?? null,
    messageId: event.messageId ?? null,
    deliveryId: event.deliveryId ?? null,
  };
}
