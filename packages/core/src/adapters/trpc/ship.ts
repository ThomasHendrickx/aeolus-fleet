import {
  ackInputSchema,
  cancelScheduleInputSchema,
  cancelScheduleOutputSchema,
  pauseScheduleInputSchema,
  pauseScheduleOutputSchema,
  resumeScheduleInputSchema,
  resumeScheduleOutputSchema,
  scheduleInputSchema,
  scheduleOutputSchema,
  schedulesInputSchema,
  schedulesOutputSchema,
  ackOutputSchema,
  deregisterOutputSchema,
  handedInputSchema,
  handedOutputSchema,
  deliveryInputSchema,
  deliveryOutputSchema,
  handledInputSchema,
  handledOutputSchema,
  inboxInputSchema,
  inboxOutputSchema,
  meetingShipInputSchema,
  addToMeetingInputSchema,
  meetingInputSchema,
  meetingOutputSchema,
  meetingIdInputSchema,
  meetingChangedOutputSchema,
  notHandledInputSchema,
  openMeetingInputSchema,
  openMeetingOutputSchema,
  setMicPatternInputSchema,
  PAGE_SIZE_DEFAULT,
  notHandledOutputSchema,
  PING_CONTENT_TYPE,
  pongInputSchema,
  pongOutputSchema,
  pushReceiveInputSchema,
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
import { scheduleTimingOf, schedulesPageOf } from './schedule-output.js';

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
        'or any one ship of a type { "kind": "type", "type": "..." },',
        'or every other participant of a meeting you take part in { "kind": "meeting", "meetingId": "mtg_..." }: a contribution, one delivery each,',
        'which names no inReplyTo and is never forced, from the moderator or the holder of the mic only (request it with requestMic),',
        'or every ship carrying every value of a label selection { "kind": "label", "valueIds": ["lbv_..."] }, never you: one delivery for every ship of it,',
        'refused whole when one of them is out of your reach; learn a value\'s id with fleet_findLabelValue.',
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
   * Opens a meeting of the calling ship and the ships it invites, owned and
   * moderated by the caller (decision 0061). Answers with the meeting's id
   * only once the meeting and every added notice are stored.
   */
  openMeeting: scopedProcedure('meetings:open')
    .meta({
      description: [
        'Needs meetings:open. Opens a meeting: you own and moderate it, and every ship you invite takes part.',
        'ships invites ships by id { "shipId": "shp_..." } or by name { "name": "..." }; valueIds invites the ships carrying every one of those label values.',
        'You must reach every invitee by send, or nothing is opened (NOT_REACHABLE); inside, participants reach each other whatever their own reach.',
        'Each invitee gets a message from you of application/vnd.aeolus.meeting.added+json naming the meeting, its owner, moderator and participants.',
        'Contribute with send and the selector { "kind": "meeting", "meetingId": "mtg_..." }.',
        'model is the exact model id you run now, as on send. idempotencyKey is a new unique string for every meeting:',
        'a retry with it answers the same meetingId, and another request with a used key is refused (CONFLICT).',
      ].join(' '),
      requiredOfCrews: ['model'],
    })
    .input(openMeetingInputSchema)
    .output(openMeetingOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.openMeeting(ctx.caller, input))),

  /**
   * A meeting the caller takes part in, with its participants as they are
   * now and a page of what was said so far, newest first (decision 0061).
   */
  meeting: scopedProcedure('messages:receive')
    .meta({
      description: [
        'For a meeting you take part in, by its meetingId: its owner and moderator, when it opened and ended,',
        'each participant with its kind and status (crewed or awaitingCrew), its mic (holder, null while free; pattern; requests oldest first),',
        'and what was said so far, newest first,',
        'a page at a time: pass the nextCursor it answers as cursor for the page before. A late or rejoined participant reads here what it missed.',
        'A meeting you take no part in is refused as one that does not exist (NOT_FOUND).',
      ].join(' '),
    })
    .input(meetingInputSchema)
    .output(meetingOutputSchema)
    .query(async ({ ctx, input }) => {
      const read = okOrThrow(await ctx.useCases.readMeeting(ctx.caller, { meetingId: input.meetingId, cursor: input.cursor, limit: input.limit ?? PAGE_SIZE_DEFAULT }));
      return {
        ...read,
        openedAt: read.openedAt.toISOString(),
        endedAt: read.endedAt?.toISOString() ?? null,
        mic: { ...read.mic, requests: read.mic.requests.map((request) => ({ ...request, requestedAt: request.requestedAt.toISOString() })) },
        contributions: { ...read.contributions, items: read.contributions.items.map((item) => ({ ...item, sentAt: item.sentAt.toISOString() })) },
      };
    }),

  /** Puts the caller on its meeting's mic list (decision 0061, M8); first in line, a free mic goes to it at once. */
  requestMic: scopedProcedure('messages:send')
    .meta({
      description: [
        'Requests the mic of a meeting you take part in: only the moderator and the holder of the mic contribute.',
        'You join the back of the list with the time of your request; one request per ship (CONFLICT for a second, or while you hold it).',
        'The moderator gives the mic, or it goes to the oldest request when the moderator set fifo.',
        'When you get it, the moderator sends you a message of application/vnd.aeolus.meeting.mic+json naming the meeting. The moderator needs no mic (BAD_REQUEST).',
      ].join(' '),
    })
    .input(meetingIdInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMic(ctx.caller, { meetingId: input.meetingId, change: { kind: 'request' } }));
      return {};
    }),

  /** Takes the caller's request off its meeting's mic list (decision 0061, M8). */
  withdrawMicRequest: scopedProcedure('messages:send')
    .meta({ description: 'Withdraws your request for the mic of a meeting: you leave the list. CONFLICT when you have no request.' })
    .input(meetingIdInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMic(ctx.caller, { meetingId: input.meetingId, change: { kind: 'withdraw' } }));
      return {};
    }),

  /** The holder frees the mic of its meeting (decision 0061, M10). */
  releaseMic: scopedProcedure('messages:send')
    .meta({
      description: [
        'Releases the mic of a meeting you hold it in: say you no longer need it once you are done. It never frees by itself.',
        'With fifo set, it goes on to the oldest request. To speak again, request it again. CONFLICT when you do not hold it.',
      ].join(' '),
    })
    .input(meetingIdInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMic(ctx.caller, { meetingId: input.meetingId, change: { kind: 'release' } }));
      return {};
    }),

  /** The moderator gives the mic of its meeting to a participant (decision 0061, M9). */
  giveMic: scopedProcedure('messages:send')
    .meta({
      description: [
        'For the moderator: gives the mic of the meeting to the participant shipId, on the list or not, straight from its holder if one holds it.',
        'That ship leaves the list and is told by a message from you of application/vnd.aeolus.meeting.mic+json.',
        'FORBIDDEN for a ship that does not moderate; NOT_FOUND for a ship that takes no part.',
      ].join(' '),
    })
    .input(meetingShipInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMic(ctx.caller, { meetingId: input.meetingId, change: { kind: 'give', shipId: input.shipId } }));
      return {};
    }),

  /** The moderator takes the mic of its meeting back from its holder (decision 0061, M10). */
  takeMic: scopedProcedure('messages:send')
    .meta({
      description: [
        'For the moderator: takes the mic of the meeting back from its holder, as when it is never released or its session is gone.',
        'With fifo set, it goes on to the oldest request. CONFLICT while the mic is free; FORBIDDEN for a ship that does not moderate.',
      ].join(' '),
    })
    .input(meetingIdInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMic(ctx.caller, { meetingId: input.meetingId, change: { kind: 'take' } }));
      return {};
    }),

  /** The moderator sets how its meeting's free mic passes (decision 0061, M9). */
  setMicPattern: scopedProcedure('messages:send')
    .meta({
      description: [
        'For the moderator: sets how the free mic of the meeting passes. moderator (the default): you give it to whom you like;',
        'fifo: a free mic goes to the oldest request at once, and a ship that requests again after speaking makes it a round robin.',
        'The holder keeps the mic either way. FORBIDDEN for a ship that does not moderate.',
      ].join(' '),
    })
    .input(setMicPatternInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMic(ctx.caller, { meetingId: input.meetingId, change: { kind: 'setPattern', pattern: input.pattern } }));
      return {};
    }),

  /** The owner adds ships to its open meeting later (decision 0061, M5, M6, M13). */
  addToMeeting: scopedProcedure('messages:send')
    .meta({
      description: [
        'For the owner: adds ships to the meeting, by id { "shipId": "shp_..." } or name { "name": "..." } in ships, and by a label selection in valueIds, as openMeeting names them.',
        'You must reach each one by send, or none is added (NOT_REACHABLE). A ship that left or was revoked comes back with its right; one present stays as it is.',
        'Each added ship gets a message from you of application/vnd.aeolus.meeting.added+json, its deliveries from joining on, and reads what was said so far with meeting.',
        'model is the exact model id you run now, as on send.',
      ].join(' '),
      requiredOfCrews: ['model'],
    })
    .input(addToMeetingInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.addToMeeting(ctx.caller, input));
      return {};
    }),

  /** A participant leaves its meeting, keeping its right to rejoin (decision 0061, M13). */
  leaveMeeting: scopedProcedure('messages:send')
    .meta({
      description: [
        'Leaves a meeting you take part in: contributions no longer reach you and your mic request goes. You keep your right: rejoin with rejoinMeeting.',
        'The owner cannot leave (CONFLICT): transfer the meeting first. A moderator that leaves gives the moderatorship to the owner.',
      ].join(' '),
    })
    .input(meetingIdInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMeeting(ctx.caller, { meetingId: input.meetingId, change: { kind: 'leave' } }));
      return {};
    }),

  /** A ship that left its meeting comes back by itself (decision 0061, M5, M13). */
  rejoinMeeting: scopedProcedure('messages:send')
    .meta({
      description: [
        'Rejoins a meeting you left: deliveries reach you from now on, and meeting reads what you missed.',
        "Checked on the owner's reach of your ship (NOT_REACHABLE). Refused once the owner revoked your right (FORBIDDEN), and while you take part (CONFLICT).",
      ].join(' '),
    })
    .input(meetingIdInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMeeting(ctx.caller, { meetingId: input.meetingId, change: { kind: 'rejoin' } }));
      return {};
    }),

  /** The owner revokes a ship's right to its meeting (decision 0061, M13). */
  revokeFromMeeting: scopedProcedure('messages:send')
    .meta({ description: 'For the owner: takes the ship shipId out of the meeting and its right with it. It cannot rejoin; only you adding it again brings it back. The owner is never revoked.' })
    .input(meetingShipInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMeeting(ctx.caller, { meetingId: input.meetingId, change: { kind: 'revoke', shipId: input.shipId } }));
      return {};
    }),

  /** The owner transfers its meeting to another participant (decision 0061, M2). */
  transferMeeting: scopedProcedure('messages:send')
    .meta({ description: "For the owner: makes the participant shipId the owner of the meeting. From then on its reach decides who is added and who rejoins; you may then leave." })
    .input(meetingShipInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMeeting(ctx.caller, { meetingId: input.meetingId, change: { kind: 'transfer', shipId: input.shipId } }));
      return {};
    }),

  /** The owner names the moderator of its meeting (decision 0061, M3). */
  nameModerator: scopedProcedure('messages:send')
    .meta({ description: 'For the owner: makes the participant shipId the moderator of the meeting. It needs no mic, so a mic it held is freed and its request goes.' })
    .input(meetingShipInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMeeting(ctx.caller, { meetingId: input.meetingId, change: { kind: 'nameModerator', shipId: input.shipId } }));
      return {};
    }),

  /** The owner or the moderator ends its meeting (decision 0061, M15). */
  endMeeting: scopedProcedure('messages:send')
    .meta({
      description: [
        'For the owner or the moderator: ends the meeting. Every other participant gets a message from you of application/vnd.aeolus.meeting.ended+json naming it.',
        'It then takes no contributions, participants or mic changes; deliveries pending still arrive, and every former participant reads it with meeting.',
      ].join(' '),
    })
    .input(meetingIdInputSchema)
    .output(meetingChangedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.changeMeeting(ctx.caller, { meetingId: input.meetingId, change: { kind: 'end' } }));
      return {};
    }),

  /**
   * Schedules a message that core sends at its time as the caller (decision
   * 0062): a whole send input, checked now as a send, and its reach now.
   * Answers the schedule's id once it is stored.
   */
  schedule: scopedProcedure('messages:send')
    .meta({
      description: [
        'Needs messages:send, and messages:force when isForced. Schedules a message that the fleet sends as you at its times, even while your ship has no crew:',
        'a whole send input (selector of a ship by id or name, or a type; payload; contentType; inReplyTo; isForced), stored as given, and a timing:',
        '{ "kind": "once", "at": "<ISO 8601 instant with its offset>" } in the future;',
        '{ "kind": "every", "every": "<ISO 8601 duration such as PT6H>" }, from start or else one interval after now;',
        'or { "kind": "cron", "cron": "<five fields such as 0 9 * * MON-FRI>", "timeZone": "<IANA zone, UTC by default>" }, a wall time summer time skips sending at the first valid minute after it, a doubled one once.',
        'every and cron take optional start and end (instants with their offset) and count (the number of messages it sends), either of the last two ending it.',
        'You must reach the selector by send now, and at each send time it is checked again as a send by you then (scopes, reach, the daily message limit).',
        'onRefused says what a refused send time does: skip (default) records it and goes on to the next send time; retry tries again each pass until retryWindow (ISO 8601 duration from the send time, PT1H by default) ends, then skips; pause records it and pauses the schedule.',
        'onMissed says what a send time the fleet reaches later than grace (ISO 8601 duration, PT5M by default) does: each (default) sends every missed one, oldest first, at most 100 a pass; once sends only the latest; skip sends none; each one not sent is recorded.',
        'The message names scheduleId and sendTime, beside the contentType you picked. model is the exact model id you run now; the message states it.',
        'idempotencyKey is a new unique string for every schedule: a retry with it answers the same scheduleId, and another request with a used key is refused (CONFLICT).',
      ].join(' '),
      requiredOfCrews: ['model'],
    })
    .input(scheduleInputSchema)
    .output(scheduleOutputSchema)
    .mutation(async ({ ctx, input }) =>
      okOrThrow(
        await ctx.useCases.scheduleMessage(ctx.caller, {
          selector: input.selector,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey,
          timing: scheduleTimingOf(input.timing),
          ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.inReplyTo === undefined ? {} : { inReplyTo: input.inReplyTo }),
          ...(input.isForced === undefined ? {} : { isForced: input.isForced }),
          ...(input.onRefused === undefined ? {} : { onRefused: input.onRefused }),
          ...(input.retryWindow === undefined ? {} : { retryWindow: input.retryWindow }),
          ...(input.onMissed === undefined ? {} : { onMissed: input.onMissed }),
          ...(input.grace === undefined ? {} : { grace: input.grace }),
        }),
      ),
    ),

  /** The caller's own schedules, newest first, a page at a time (decision 0062). */
  schedules: scopedProcedure('messages:send')
    .meta({
      description: [
        'Your schedules, newest first, without their payloads: each with its state (active, paused, ended, cancelled), timing, strategies, next send time',
        'and last outcome: the message it sent, the code a send time was refused with, or a send time missed, each with its send time.',
        'Active and paused ones unless states names others, such as ["ended"] to read how a schedule ended.',
        'A page at a time: pass the nextCursor it answers as cursor for the next page.',
      ].join(' '),
    })
    .input(schedulesInputSchema)
    .output(schedulesOutputSchema)
    .query(async ({ ctx, input }) =>
      schedulesPageOf(
        okOrThrow(
          await ctx.useCases.listSchedules(ctx.caller, {
            shipId: ctx.caller.shipId,
            limit: input.limit ?? PAGE_SIZE_DEFAULT,
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            ...(input.states === undefined ? {} : { states: input.states }),
          }),
        ),
      ),
    ),

  /** Pauses one of the caller's schedules until it resumes it (decision 0062, S10). */
  pauseSchedule: scopedProcedure('messages:send')
    .meta({
      description: [
        'Pauses one of your schedules by its scheduleId: it sends nothing until you resume it. Pausing a paused one answers it paused again;',
        'an ended or cancelled one is refused (CONFLICT). A fleet manager may pause it too.',
      ].join(' '),
    })
    .input(pauseScheduleInputSchema)
    .output(pauseScheduleOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.pauseSchedule(ctx.caller, input))),

  /** Resumes one of the caller's paused schedules, skipping the send times passed while paused (decision 0062, S10). */
  resumeSchedule: scopedProcedure('messages:send')
    .meta({
      description: [
        'Resumes one of your paused schedules by its scheduleId. The send times passed while it was paused are skipped: it goes on at its next send time after now,',
        'or ends (state ended) when it has none left. Resuming an active one answers it active again; an ended or cancelled one is refused (CONFLICT).',
      ].join(' '),
    })
    .input(resumeScheduleInputSchema)
    .output(resumeScheduleOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.resumeSchedule(ctx.caller, input))),

  /** Cancels one of the caller's schedules: it sends nothing more (decision 0062). */
  cancelSchedule: scopedProcedure('messages:send')
    .meta({
      description: [
        'Cancels one of your schedules by its scheduleId: it sends nothing more. Cancelling a cancelled one answers it cancelled again; an ended one is refused (CONFLICT).',
        'There is no edit: cancel and schedule anew.',
      ].join(' '),
    })
    .input(cancelScheduleInputSchema)
    .output(cancelScheduleOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.cancelSchedule(ctx.caller, input))),

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
      return { deliveries: deliveries.map((delivery) => ({ ...delivery, sentAt: delivery.sentAt.toISOString(), sendTime: delivery.sendTime?.toISOString() ?? null })) };
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
      return { deliveries: deliveries.map((delivery) => ({ ...delivery, sentAt: delivery.sentAt.toISOString(), sendTime: delivery.sendTime?.toISOString() ?? null })) };
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
        'Your first pushReceive may state waker, what wakes the ship: trierarch, pluginWatcher, personApp, gateway or adapter; the lease keeps the first one, and the ship\'s page shows it.',
        'Report each hand-over to the agent with handed.',
      ].join(' '),
    })
    .input(pushReceiveInputSchema)
    .output(pushReceiveOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const { deliveries } = okOrThrow(
        await ctx.useCases.pushReceiveDeliveries(ctx.crew, { max: input?.max, ...(input?.waker === undefined ? {} : { waker: input.waker }) }),
      );
      return { deliveries: deliveries.map((delivery) => ({ ...delivery, sentAt: delivery.sentAt.toISOString(), sendTime: delivery.sendTime?.toISOString() ?? null })) };
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
        'channel names how you handed it over, such as tmux, watcher, email or tools/call (1 to 32 of a-z, 0-9, /, . and -); the delivery\'s history shows it.',
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
        "For calls through the gateway each may also state waitMs (0 to 120000, how long a call may be held for the reply), deadlineMs (up to 7 days, when a call fails),",
        "repeatable (whether a call that died unconfirmed may be handed again) and MCP's tool annotations; core acts on none of them.",
        'Set whole, at most 64 KB as JSON; the same statement again changes nothing. It is kept with your lease and goes when it ends,',
        'so state it once crewed and again when it changes. Answers its version (decision 0047).',
      ].join(' '),
    })
    .input(setStatementInputSchema)
    .output(setStatementOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.setStatement(ctx.crew, input))),

  /**
   * The ships and types the caller may send to now, with each ship's
   * statement and verified facts (decisions 0047, 0059). Needs messages:send;
   * records nothing.
   */
  discover: scopedProcedure('messages:send')
    .meta({
      description: [
        'Needs messages:send. Answers the ships you may send to now, as a send would be checked, each with its id, name, type, kind, status and statement,',
        "and each type with how many of its ships you reach. A statement is its crew's (by crew, with its version) while one is stated,",
        'else the note it was commissioned with (by commission), else null. Beside it, verified: the facts an actor checked about the ship, as its writer wrote them, each with by (its writer) and at,',
        'oldest first (decision 0059); the fleet checks nothing in them. You, the viewer and retired ships are left out.',
        'It answers ships, never rules, and records nothing (decision 0047).',
      ].join(' '),
    })
    .output(discoverOutputSchema)
    .query(async ({ ctx }) => okOrThrow(await ctx.useCases.discover(ctx.caller))),

  /**
   * Where each delivery of a message the caller sent stands, and since when
   * (interop 3.5). Needs messages:send; its own messages only, and no payload.
   */
  sentMessage: scopedProcedure('messages:send')
    .meta({
      description: [
        'Needs messages:send. For a message you sent, by its messageId: where each of its deliveries stands (its state: pending, received, handed, acknowledged,',
        'handled, notHandled, undeliverable, dismissed or abandoned), since when and the ship it went to (null while no ship of a type claimed it):',
        'one delivery for a ship or a type, one per ship for a label. Its recipient by name, type or the value ids you sent to. No payload comes back.',
        'A message another ship sent, or one the fleet does not have, is refused as MESSAGE_NOT_FOUND.',
      ].join(' '),
    })
    .input(sentMessageInputSchema)
    .output(sentMessageOutputSchema)
    .query(async ({ ctx, input }) => {
      const sent = okOrThrow(await ctx.useCases.sentMessage(ctx.caller, input));
      return { ...sent, sentAt: sent.sentAt.toISOString(), deliveries: sent.deliveries.map((delivery) => ({ ...delivery, since: delivery.since.toISOString() })) };
    }),

  /**
   * Reads one acknowledged delivery of the crew's lease again, whole, while
   * it is not yet handled, such as a message opened in one client and read
   * again from another. Records nothing (decision 0040).
   */
  delivery: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'Needs messages:receive. Reads a delivery you acknowledged again, whole, as receive handed it, by its deliveryId (dlv_...),',
        'until it is handled: to answer it or finish it from another client. It changes nothing: no attempt, no ack, no event.',
        'Only one your crew acknowledged: one of yours in another state, such as handled, is refused as DELIVERY_NOT_ACKNOWLEDGED, naming its state;',
        'any other is refused as DELIVERY_NOT_FOUND.',
      ].join(' '),
    })
    .input(deliveryInputSchema)
    .output(deliveryOutputSchema)
    .query(async ({ ctx, input }) => {
      const reread = okOrThrow(await ctx.useCases.readDelivery(ctx.crew, input));
      return { ...reread, sentAt: reread.sentAt.toISOString(), sendTime: reread.sendTime?.toISOString() ?? null };
    }),

  /**
   * How many deliveries wait for the crew: what its next receive would hand
   * it. Claims nothing. With waitSeconds (0 to 25) it waits while none does,
   * or with knownWaiting while the count is still that.
   * A mutation only so that REST takes its body; it changes nothing.
   */
  inbox: scopedCrewProcedure('messages:receive')
    .meta({
      description: [
        'Tells you how many deliveries wait for you: what your next receive would hand you, your own unacknowledged ones included.',
        'It claims nothing, so call receive to get them.',
        'With waitSeconds (0 to 25) it waits while none does, and answers as soon as one arrives.',
        'With knownWaiting as well, the waiting count you already know, it waits while the count is still that,',
        'and answers as soon as it differs: a delivery arrived, or one you held was acknowledged.',
      ].join(' '),
    })
    .input(inboxInputSchema)
    .output(inboxOutputSchema)
    .mutation(async ({ ctx, input }) =>
      okOrThrow(await ctx.useCases.checkInbox(ctx.crew, { waitSeconds: input?.waitSeconds, knownWaiting: input?.knownWaiting })),
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
