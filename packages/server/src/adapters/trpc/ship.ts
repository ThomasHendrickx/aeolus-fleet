import {
  ackInputSchema,
  ackOutputSchema,
  receiveInputSchema,
  receiveOutputSchema,
  registerInputSchema,
  registerOutputSchema,
  sendInputSchema,
  sendOutputSchema,
  whoamiOutputSchema,
} from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import { authenticatedProcedure, crewProcedure, okOrThrow, publicProcedure, router, scopedProcedure } from './trpc.js';

/**
 * Ship procedures: the ship contract. `register` takes the ship's id and
 * secret and returns a crew token; every later call carries that token as
 * `Authorization: Bearer` (ADR 0015). REST and MCP will map onto these.
 */
export const shipRouter = router({
  /**
   * Claims the ship for the calling session, which reports where it runs. The
   * secret travels in the body, never as a bearer; the crew token comes back
   * once. Only a wrong ship id or secret counts against the client's limit, so
   * one address can start many sessions (ADR 0015); a client over it is
   * refused before its secret is even checked.
   */
  register: publicProcedure
    .use(({ ctx, next }) => {
      if (!ctx.registerFailures.hasRoom(ctx.clientKey)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many failed register attempts. Wait a minute.' });
      }
      return next();
    })
    .input(registerInputSchema)
    .output(registerOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const claimed = await ctx.useCases.claimShip(input);
      if (!claimed.isOk && claimed.error.kind === 'WRONG_SHIP_ID_OR_SECRET') {
        ctx.registerFailures.count(ctx.clientKey);
      }
      return okOrThrow(claimed);
    }),

  /** The caller's ship: id, fleet, name and type. Any caller may ask about itself. */
  whoami: authenticatedProcedure
    .output(whoamiOutputSchema)
    .query(async ({ ctx }) => okOrThrow(await ctx.useCases.whoami(ctx.caller))),

  /**
   * Sends a message from the calling ship, `argo` included, to a selector.
   * Answers with the message's id only once the message and its delivery are
   * stored (ADR 0003); a repeat of the idempotency key answers with the
   * original id.
   */
  send: scopedProcedure('messages:send')
    .input(sendInputSchema)
    .output(sendOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.sendMessage(ctx.caller, input))),

  /**
   * Hands the crew up to `max` deliveries, 1 to 10, one by default: its own
   * in flight first, then the oldest pending for its ship or its type. Waits
   * about 25 seconds when none is there, then answers with none. A mutation:
   * every delivery it returns is claimed.
   */
  receive: crewProcedure('messages:receive')
    .input(receiveInputSchema)
    .output(receiveOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { deliveries } = okOrThrow(await ctx.useCases.receiveDeliveries(ctx.crew, { max: input?.max }));
      return { deliveries: deliveries.map((delivery) => ({ ...delivery, sentAt: delivery.sentAt.toISOString() })) };
    }),

  /** Acknowledges a delivery the ship received: it is done. Acknowledging it again is OK. */
  ack: crewProcedure('messages:receive')
    .input(ackInputSchema)
    .output(ackOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.acknowledgeDelivery(ctx.crew, input));
      return {};
    }),
});
