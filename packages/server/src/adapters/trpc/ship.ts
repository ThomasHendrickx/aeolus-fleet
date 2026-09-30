import {
  ackInputSchema,
  ackOutputSchema,
  deregisterOutputSchema,
  receiveInputSchema,
  receiveOutputSchema,
  registerInputSchema,
  registerOutputSchema,
  sendInputSchema,
  sendOutputSchema,
  whoamiOutputSchema,
} from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import {
  authenticatedProcedure,
  crewProcedure,
  okOrThrow,
  publicProcedure,
  router,
  scopedCrewProcedure,
  scopedProcedure,
} from './trpc.js';

/**
 * Ship procedures: the ship contract. `register` takes the ship's id and
 * secret and returns a crew token; every later call carries that token as
 * `Authorization: Bearer` (ADR 0015), or as the `crewToken` argument of an MCP
 * tool. REST and MCP map onto these (ship-contract.ts).
 *
 * Each description speaks to the agent crewing a ship, who reads it on every
 * call as an MCP tool or a REST operation: what the call does and the rules
 * for using it. It names the calls, never the door, since both doors show it.
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
    .meta({
      description: [
        'Claims your ship for this conversation. Call it first, once, with the ship id and secret from your starting prompt',
        'and where you run: location { "kind": "DEVICE" }, "CLOUD" or "SERVER", or { "kind": "OTHER", "description": "..." }.',
        'It answers with your crew token, only this once: keep it, since every other ship call carries it and nothing shows it again.',
        'The secret works only here. A ship another session crews is refused (CONFLICT) until the operator releases it.',
      ].join(' '),
    })
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
    .meta({
      description:
        'Tells you which ship you crew: its id, fleet, name and type. Other ships reach you by that name, or by your type.',
    })
    .output(whoamiOutputSchema)
    .query(async ({ ctx }) => okOrThrow(await ctx.useCases.whoami(ctx.caller))),

  /**
   * Sends a message from the calling ship, `argo` included, to a selector.
   * Answers with the message's id only once the message and its delivery are
   * stored (ADR 0003); a repeat of the idempotency key answers with the
   * original id.
   */
  send: scopedProcedure('messages:send')
    .meta({
      description: [
        'Sends a message from your ship. It answers with the messageId only once the message is stored:',
        'from then on it reaches its recipient, even one that is not running now.',
        'selector picks the recipient: one ship by name { "kind": "ship", "name": "..." } or by id { "kind": "ship", "shipId": "shp_..." },',
        'or any one ship of a type { "kind": "type", "type": "..." }.',
        "To answer a delivery, send to its senderName and set inReplyTo to its messageId: the message id, not the delivery id.",
        'payload is text of at most 64 KB: a reference to the content and an instruction, not the content itself.',
        'contentType is text/plain unless you say otherwise.',
        'idempotencyKey is a new unique string for every message. Reuse one only to retry the same send after an error or a lost answer:',
        'the retry answers with the original messageId instead of sending twice, and a different send with a used key is refused (CONFLICT).',
      ].join(' '),
    })
    .input(sendInputSchema)
    .output(sendOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.sendMessage(ctx.caller, input))),

  /**
   * Hands the crew up to `max` deliveries, 1 to 10, one by default: its own
   * in flight first, then the oldest pending for its ship or its type. Waits
   * about 25 seconds when none is there, then answers with none. A mutation:
   * every delivery it returns is claimed.
   */
  receive: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'Hands you your next deliveries, up to max (1 to 10, one when left out), each with its message and its sender:',
        'senderShipId, senderName (the name to answer to) and senderType.',
        'With none there it waits about 25 seconds, then answers with none: call it again at once, as often as you like.',
        'Ack every delivery right away, as soon as you have it and before you act on it.',
        'Until you ack it a delivery stays yours: your next receive hands it to you again,',
        'and after four receives without an ack it goes to the operator as undeliverable.',
        'So you may see a deliveryId twice: treat it as the key of the work.',
        'To answer, send to senderName with inReplyTo set to the messageId.',
      ].join(' '),
    })
    .input(receiveInputSchema)
    .output(receiveOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { deliveries } = okOrThrow(await ctx.useCases.receiveDeliveries(ctx.crew, { max: input?.max }));
      return { deliveries: deliveries.map((delivery) => ({ ...delivery, sentAt: delivery.sentAt.toISOString() })) };
    }),

  /** Acknowledges a delivery the ship received: it is done. Acknowledging it again is OK. */
  ack: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'Acknowledges a delivery: you take responsibility for it, and it is done.',
        'Call it right away, as soon as you receive the delivery and before you act on it; what you do next is your own business.',
        'Pass its deliveryId (dlv_...), not its messageId. Acknowledging it again is fine.',
        'Only the ship holding the delivery can ack it.',
      ].join(' '),
    })
    .input(ackInputSchema)
    .output(ackOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.acknowledgeDelivery(ctx.crew, input));
      return {};
    }),

  /**
   * Ends the calling crew's own lease, and with it its crew token: the ship
   * awaits a new crew, its secret stops working, and what it held in flight
   * returns to pending for the next crew. Needs only the crew token.
   */
  deregister: crewProcedure
    .meta({
      description: [
        'Ends your session cleanly: your crew token and your ship\'s secret stop working,',
        'and any delivery you received but did not ack goes back to pending for the next crew.',
        'The ship and its inbox stay; a new crew needs a new starting prompt from the operator.',
      ].join(' '),
    })
    .output(deregisterOutputSchema)
    .mutation(async ({ ctx }) => {
      okOrThrow(await ctx.useCases.deregister(ctx.crew));
      return {};
    }),
});
