import {
  ackInputSchema,
  ackOutputSchema,
  deregisterOutputSchema,
  handedInputSchema,
  handedOutputSchema,
  handledInputSchema,
  handledOutputSchema,
  inboxInputSchema,
  inboxOutputSchema,
  notHandledInputSchema,
  notHandledOutputSchema,
  PING_CONTENT_TYPE,
  pongInputSchema,
  pongOutputSchema,
  pushReceiveOutputSchema,
  reportInputSchema,
  reportLogOutputSchema,
  reportOutputSchema,
  setStatementInputSchema,
  setStatementOutputSchema,
  discoverOutputSchema,
  sentMessageInputSchema,
  sentMessageOutputSchema,
  turnInputSchema,
  turnOutputSchema,
  receiveInputSchema,
  receiveReplyInputSchema,
  receiveOutputSchema,
  registerInputSchema,
  registerOutputSchema,
  sendInputSchema,
  sendOutputSchema,
  whoamiOutputSchema,
  type ShipReportOutput,
} from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import type { ShipReport } from '../../domain/registry/ship-report.js';

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
 * call as an MCP tool or a REST operation: what the call does and its own
 * rules. When to make each call is the ship protocol's (ship-protocol.ts),
 * which no description repeats. It names the calls, never the door, since
 * both doors show it.
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
        'Claims your ship for this conversation, with the ship id and secret from your starting prompt',
        'and where you run: location { "kind": "DEVICE" }, "CLOUD" or "SERVER", or { "kind": "OTHER", "description": "..." },',
        'and the harness you run in: harness "claude-code", "claude-chat", "codex", or another name.',
        'It answers with your crew token, and only this once.',
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
        'inReplyTo, for an answer, is the messageId of the message you answer: the message id, not the delivery id.',
        'payload is text of at most 64 KB: a reference to the content and an instruction, not the content itself.',
        'contentType is text/plain unless you say otherwise.',
        'model is the exact model id you run now, such as claude-opus-5-5: state it on every send, as it is now, even after a switch. A send without it is refused (BAD_REQUEST); only argo, the operator, states none.',
        'Code that runs no model, such as a script, states its package or name and the version it runs, such as nightly-report@1.4.0.',
        'idempotencyKey is a new unique string for every message. Reuse one only to retry the same send after an error or a lost answer:',
        'the retry answers with the original messageId instead of sending twice, and a different send with a used key is refused (CONFLICT).',
        'isForced: true sends a forced message, one to act on now: its delivery comes before every other in the recipient\'s receive.',
        'It needs the messages:force scope (FORBIDDEN without it).',
      ].join(' '),
      requiredOfCrews: ['model'],
    })
    .input(sendInputSchema)
    .output(sendOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.sendMessage(ctx.caller, input))),

  /**
   * Hands the crew up to `max` deliveries, 1 to 10, one by default: forced
   * ones first (decision 0040), then its own in flight, then the oldest
   * pending for its ship or its type. Waits
   * about 25 seconds when none is there, then answers with none. A mutation:
   * every delivery it returns is claimed.
   */
  receive: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'Hands you your next deliveries, up to max (1 to 10, one when left out), each with its message and its sender:',
        'senderShipId, senderName (the name to answer to) and senderType.',
        'A forced message, one to act on now, comes before every other.',
        'With none there it waits about 25 seconds, then answers with none.',
        'Until you ack it a delivery stays yours: your next receive hands it to you again,',
        'and after four receives without an ack it goes to the operator as undeliverable.',
        'So you may see a deliveryId twice: treat it as the key of the work.',
      ].join(' '),
    })
    .input(receiveInputSchema)
    .output(receiveOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { deliveries } = okOrThrow(await ctx.useCases.receiveDeliveries(ctx.crew, { max: input?.max }));
      return { deliveries: deliveries.map((delivery) => ({ ...delivery, sentAt: delivery.sentAt.toISOString() })) };
    }),

  /**
   * Receives the reply to one message the crew names, for a crew with many
   * requests open that waits on one of them: as receive does, one delivery
   * at most.
   */
  receiveReply: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'Hands you the reply to one message: the oldest delivery whose message names messageId as its inReplyTo, with its message and its sender, as receive hands one.',
        'Use it when you sent several requests and wait for the answer to one. Your other deliveries stay where they are.',
        'With none there it waits about 25 seconds, then answers with none.',
        'Until you ack it the reply stays yours: the next receiveReply or receive hands it to you again,',
        'and after four without an ack it goes to the operator as undeliverable.',
      ].join(' '),
    })
    .input(receiveReplyInputSchema)
    .output(receiveOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { deliveries } = okOrThrow(await ctx.useCases.receiveReply(ctx.crew, input));
      return { deliveries: deliveries.map((delivery) => ({ ...delivery, sentAt: delivery.sentAt.toISOString() })) };
    }),

  /**
   * The computer side's receive (decision 0040), for the trierarch or the
   * plugin watcher, never the agent: takes up to `max` deliveries as
   * received, counting no attempt, forced ones first, then its own in
   * flight, and makes the
   * lease pushed until it ends. Waits as receive does. A mutation: every
   * delivery it returns is the crew's.
   */
  pushReceive: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'For the trierarch or the plugin watcher, not the agent: takes your next deliveries for the computer side, up to max (1 to 10, one when left out),',
        'each with its message, its sender, its state and its last hand-over number. A pending one becomes received: yours, with no attempt counted.',
        'Forced deliveries come first; then your own received or handed ones again, unchanged, so a restart loses nothing. With none there it waits about 25 seconds, then answers with none.',
        'From your first pushReceive until your lease ends, the agent\'s plain receive answers nothing.',
        'Report each hand-over to the agent with handed.',
      ].join(' '),
    })
    .input(receiveInputSchema)
    .output(pushReceiveOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { deliveries } = okOrThrow(await ctx.useCases.pushReceiveDeliveries(ctx.crew, { max: input?.max }));
      return { deliveries: deliveries.map((delivery) => ({ ...delivery, sentAt: delivery.sentAt.toISOString() })) };
    }),

  /**
   * The computer side reports it handed a delivery to the agent, with its
   * hand-over number (decision 0040): a higher number counts one attempt,
   * a repeat changes nothing, and the fifth is answered undeliverable.
   */
  handed: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'For the trierarch or the plugin watcher, not the agent: says you handed a delivery to the agent, with its hand-over number (1, 2, 3 and so on under your lease).',
        'A higher number than the last counts one attempt. The same number again, or a lower one, changes nothing: retry it freely after an error or a lost answer.',
        'It answers the state: handed, acknowledged when the agent already confirmed it, or undeliverable at the fifth attempt, when nothing may be handed.',
        'When a confirmed (acknowledged) message\'s turn died, hand it once more with isOnceMore: true and your next number:',
        'it stays acknowledged and counts no attempt. A message is handed once more only once.',
      ].join(' '),
    })
    .input(handedInputSchema)
    .output(handedOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.handOverDelivery(ctx.crew, input))),

  /**
   * The hooks report the turn that took an acknowledged delivery ended by
   * itself (decision 0040): handled. Reporting it again is OK.
   */
  handled: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'For the plugin hooks or the trierarch, not the agent: says the turn that took an acknowledged delivery ended by itself, so it is handled.',
        'Pass its deliveryId (dlv_...). Again is fine. A delivery not acknowledged yet is refused: so a ping not answered with pong stays handed.',
      ].join(' '),
    })
    .input(handledInputSchema)
    .output(handledOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.reportHandled(ctx.crew, input));
      return {};
    }),

  /**
   * The hooks or the trierarch report the turn a confirmed message was handed
   * once more to died too (decision 0040): not handled, in Needs attention.
   */
  notHandled: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'For the plugin hooks or the trierarch, not the agent: says the turn a confirmed message was handed once more to died too, so it is not handled.',
        'Pass its deliveryId (dlv_...). The operator sees it in Needs attention, to resend or dismiss. Again is fine.',
        'A delivery never handed once more is refused, except one handed and not confirmed that you judged unsafe to hand again,',
        'such as an outside call that may have run: report it with the reason, which is then required.',
      ].join(' '),
    })
    .input(notHandledInputSchema)
    .output(notHandledOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.reportNotHandled(ctx.crew, input));
      return {};
    }),

  /** Acknowledges a delivery the ship received: it is done. Acknowledging it again is OK. */
  ack: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'Acknowledges a delivery: you take responsibility for it, and it is done; what you do next is your own business.',
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
   * Answers a ping the ship received: acknowledges it and marks the session
   * seen at that moment, so the operator sees the ship's model is working.
   */
  pong: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        `Answers a ping: a delivery whose contentType is ${PING_CONTENT_TYPE}.`,
        'Pass its deliveryId (dlv_...). Call pong instead of ack: it acknowledges the ping and tells the operator your session is working.',
        'Do not act on it and do not reply with a message. Answering again is fine; pong answers only a ping.',
      ].join(' '),
    })
    .input(pongInputSchema)
    .output(pongOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.answerPing(ctx.crew, input));
      return {};
    }),

  /**
   * The crew says what it is doing: working, blocked or idle, with a short
   * note and optionally its details, set whole or merge-patched. A check-in:
   * an event only when the state, note or details change.
   */
  report: crewProcedure
    .meta({
      description: [
        'Says what you are doing, for the operator and anyone who reads the fleet: state working, blocked or idle, and an optional note',
        '(one line, at most 200 characters) on what you work on or what blocks you.',
        'For structured status, details: one JSON object of at most 16 KB. details sets it whole and null clears it;',
        'detailsPatch applies a JSON Merge Patch to it (objects merge per key, null deletes a key, arrays are replaced whole).',
        'Give one of them, not both; leave both out to keep your details as they are.',
        'Call it whenever your state changes; calling it again with the same state, note and details is a check-in.',
      ].join(' '),
      example: { state: 'working', note: 'reviewing PR 89' },
    })
    .input(reportInputSchema)
    .output(reportOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.report(ctx.crew, input));
      return {};
    }),

  /**
   * The hooks report the session's turn, idle or busy, with the time they saw
   * it (decision 0040). No scope beyond being the crew.
   */
  turn: crewProcedure
    .meta({
      description: [
        'For the plugin hooks or the trierarch, not the agent: says your session\'s turn, busy while a turn runs and idle between turns,',
        'with at: the time you saw it change, in ISO 8601. A late report keeps its own time, and one older than the turn the fleet holds changes nothing.',
        'The same turn again changes nothing.',
      ].join(' '),
      example: { turn: 'busy', at: '2026-10-12T12:00:00.000Z' },
    })
    .input(turnInputSchema)
    .output(turnOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.reportTurn(ctx.crew, { turn: input.turn, at: new Date(input.at) }));
      return {};
    }),

  /**
   * The crew's own report whole, details included, and the last report of
   * the ship's previous crew, read-only. No scope beyond being the crew.
   */
  reportLog: crewProcedure
    .meta({
      description: [
        'Hands you your own report as you last made it, details included, and the last report of the crew that held your ship before you,',
        'read-only, so you can pick up where it left off. Each is null when there is none.',
      ].join(' '),
    })
    .output(reportLogOutputSchema)
    .query(async ({ ctx }) => {
      const { report, previousCrew } = okOrThrow(await ctx.useCases.reportLog(ctx.crew));
      return { report: reportOutputOf(report), previousCrew: reportOutputOf(previousCrew) };
    }),

  /**
   * The crew states what its ship is and offers (decision 0047), whole. No
   * scope beyond being the crew. Its shape is common's, parsed here.
   */
  setStatement: crewProcedure
    .meta({
      description: [
        'States what your ship is and offers, for the ships that can send to it: a summary (at most 1000 characters) and capabilities,',
        "each with MCP's tool fields name (1 to 128 letters, digits, _, - or .), title, description, inputSchema and outputSchema (JSON Schemas),",
        "and A2A's inputModes and outputModes: the media types to send it and that come back, the first the one to use.",
        'Set whole, at most 64 KB as JSON; the same statement again changes nothing. It is kept with your lease and goes when it ends,',
        'so state it once crewed and again when it changes. Answers its version (decision 0047).',
      ].join(' '),
    })
    .input(setStatementInputSchema)
    .output(setStatementOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.setStatement(ctx.crew, input))),

  /**
   * The ships and types the caller may send to now, with each ship's
   * statement (decision 0047). Needs messages:send; records nothing.
   */
  discover: scopedProcedure('messages:send')
    .meta({
      description: [
        'Needs messages:send. Answers the ships you may send to now, as a send would be checked, each with its id, name, type, kind, status and statement,',
        "and each type with how many of its ships you reach. A statement is its crew's (by crew, with its version) while one is stated,",
        'else the note it was commissioned with (by commission), else null. You, the viewer and retired ships are left out.',
        'It answers ships, never rules, and records nothing (decision 0047).',
      ].join(' '),
    })
    .output(discoverOutputSchema)
    .query(async ({ ctx }) => okOrThrow(await ctx.useCases.discover(ctx.caller))),

  /**
   * Where the delivery of a message the caller sent stands, and since when
   * (interop 3.5). Needs messages:send; its own messages only, and no payload.
   */
  sentMessage: scopedProcedure('messages:send')
    .meta({
      description: [
        'Needs messages:send. For a message you sent, by its messageId: where its delivery stands (its state: pending, received, handed, acknowledged,',
        'handled, notHandled, undeliverable, dismissed or abandoned) and since when, with its recipient by name or type. No payload comes back.',
        'A message another ship sent, or one the fleet does not have, is refused as MESSAGE_NOT_FOUND.',
      ].join(' '),
    })
    .input(sentMessageInputSchema)
    .output(sentMessageOutputSchema)
    .query(async ({ ctx, input }) => {
      const sent = okOrThrow(await ctx.useCases.sentMessage(ctx.caller, input));
      return { ...sent, sentAt: sent.sentAt.toISOString(), delivery: { ...sent.delivery, since: sent.delivery.since.toISOString() } };
    }),

  /**
   * How many deliveries wait for the crew: what its next receive would hand
   * it. Claims nothing. With waitSeconds (0 to 25) it waits while none does.
   * A mutation only so that REST takes its body; it changes nothing.
   */
  inbox: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'Tells you how many deliveries wait for you: what your next receive would hand you, your own unacknowledged ones included.',
        'It claims nothing, so call receive to get them.',
        'With waitSeconds (0 to 25) it waits while none does, and answers as soon as one arrives.',
      ].join(' '),
    })
    .input(inboxInputSchema)
    .output(inboxOutputSchema)
    .mutation(async ({ ctx, input }) =>
      okOrThrow(await ctx.useCases.checkInbox(ctx.crew, { waitSeconds: input?.waitSeconds })),
    ),

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

/** A report as a ship reads it: its time in ISO 8601, in UTC. */
function reportOutputOf(report: ShipReport | null): ShipReportOutput | null {
  return report && { ...report, reportedAt: report.reportedAt.toISOString() };
}
