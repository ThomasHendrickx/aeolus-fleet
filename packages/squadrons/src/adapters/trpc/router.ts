/**
 * squadrons' API: one tRPC router, which the web app's server calls with the
 * console's session cookie (decision 0017). Every procedure is the
 * operator's: the cookie must be a signed-in console session of the fleet
 * squadrons serves. Only `connection` works before squadrons is connected.
 */
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Catalogue } from '../../core/catalogue/catalogue.js';
import type { Connect } from '../../core/management/connect.js';
import type { ReadConnection } from '../../core/management/read-connection.js';
import type { AuthenticateOperator } from '../../core/operator/authenticate-operator.js';
import type { FormSquadron } from '../../core/squadron/form-squadron.js';
import type { ListedSquadron, ListSquadrons } from '../../core/squadron/list-squadrons.js';
import type { StandDown } from '../../core/squadron/stand-down.js';
import type { ForceStandDown } from '../../core/squadron/force-stand-down.js';
import type { KeptMessage } from '../../core/squadron/ports.js';
import { isModelMismatch, pinnedModel } from '../../core/squadron/squadron.js';
import { idSchema, type FleetId } from '@aeolus-fleet/common';

export interface Context {
  /** The Cookie header the web app's server forwarded. */
  cookie: string | undefined;
  authenticateOperator: AuthenticateOperator;
  isConnected: () => Promise<boolean>;
  readConnection: ReadConnection;
  connect: Connect;
  catalogue: () => Catalogue;
  refreshCatalogue: () => Promise<void>;
  formSquadron: FormSquadron;
  listSquadrons: ListSquadrons;
  standDown: StandDown;
  forceStandDown: ForceStandDown;
  keptMessages: (fleetId: FleetId, squadronId: string) => Promise<KeptMessage[]>;
}

/** What a caller reads of a failure: nothing of it, so no crew token or query ever leaves; the log holds it whole. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter: ({ shape, error }) =>
    error.code === 'INTERNAL_SERVER_ERROR' ? { ...shape, message: INTERNAL_ERROR_MESSAGE } : shape,
});

const operatorProcedure = t.procedure.use(async ({ ctx, next }) => {
  const operator = await ctx.authenticateOperator(ctx.cookie);
  if (!operator.isOk) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: operator.error.message });
  }
  return next({ ctx: { fleetId: operator.value.fleetId } });
});

/** The operator's procedures that need squadrons connected: until then, PRECONDITION_FAILED. */
const connectedProcedure = operatorProcedure.use(async ({ ctx, next }) => {
  if (!(await ctx.isConnected())) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'squadrons is not connected: connect it in the console' });
  }
  return next();
});

/** The refusals of connecting, as the API states them. */
const CONNECT_CODES = {
  ALREADY_CONNECTED: 'CONFLICT',
  SECRET_REFUSED: 'BAD_REQUEST',
  OTHER_FLEET: 'BAD_REQUEST',
  MISSING_SCOPES: 'BAD_REQUEST',
} as const satisfies Record<string, TRPCError['code']>;

const connectionOutputSchema = z.object({
  state: z.enum(['not-connected', 'connected']),
  ship: z.object({ shipId: z.string(), name: z.string() }).nullable(),
  lastShipId: z.string().nullable(),
});

/** The refusals of forming, as the API states them. */
const FORM_CODES = {
  BLUEPRINT_NOT_FOUND: 'NOT_FOUND',
  INVALID_SQUADRON_ID: 'BAD_REQUEST',
  SQUADRON_ID_TAKEN: 'CONFLICT',
  MANAGEMENT_SHIP_NOT_CREWED: 'PRECONDITION_FAILED',
  FORMING_FAILED: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of listing, as the API states them. */
const LIST_CODES = {
  MANAGEMENT_SHIP_NOT_CREWED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of standing down, as the API states them. */
const STAND_DOWN_CODES = {
  SQUADRON_NOT_FOUND: 'NOT_FOUND',
  NOT_SAILING: 'CONFLICT',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of forcing a stand down, as the API states them. */
const FORCE_CODES = {
  MANAGEMENT_SHIP_NOT_CREWED: 'PRECONDITION_FAILED',
  SQUADRON_NOT_FOUND: 'NOT_FOUND',
  ALREADY_DISBANDED: 'CONFLICT',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

const templateReference = z.object({ repository: z.string(), name: z.string(), version: z.number() });

/** The catalogue as the API states it, its times in ISO 8601. */
export const catalogueOutputSchema = z.object({
  templates: z.array(
    z.object({
      repository: z.string(),
      name: z.string(),
      version: z.number(),
      commit: z.string(),
      committedAt: z.iso.datetime(),
      description: z.string(),
      checkInMinutes: z.number(),
      model: z.string().nullable(),
      launchNote: z.string().nullable(),
      charter: z.string(),
      handoffs: z.array(z.object({ name: z.string(), carries: z.string() })),
    }),
  ),
  blueprints: z.array(
    z.object({
      repository: z.string(),
      name: z.string(),
      version: z.number(),
      commit: z.string(),
      committedAt: z.iso.datetime(),
      description: z.string(),
      roles: z.array(z.object({ name: z.string(), template: templateReference, count: z.number() })),
      handoffs: z.array(z.object({ role: z.string(), handoff: z.string(), to: z.string() })),
      memberNames: z.enum(['plain', 'prefixed']),
    }),
  ),
  problems: z.array(
    z.object({ repository: z.string(), kind: z.enum(['template', 'blueprint']), name: z.string(), version: z.number(), message: z.string() }),
  ),
});

const squadronOutputSchema = z.object({
  id: z.string(),
  state: z.enum(['forming', 'sailing', 'standing-down', 'disbanded']),
  blueprint: z.object({ repository: z.string(), name: z.string(), version: z.number(), commit: z.string() }),
  flagship: z.object({ shipId: z.string(), name: z.string() }),
  members: z.array(
    z.object({
      shipId: z.string(),
      name: z.string(),
      role: z.string(),
      type: z.string(),
      onStationAt: z.iso.datetime().nullable(),
      /** The model its template pins, the model it stated at its last check-in, and whether they differ. */
      model: z.object({ pinned: z.string().nullable(), stated: z.string().nullable(), isMismatch: z.boolean() }),
      /** Not on station until it comes on station with its current crew; then on time, late or silent by its last report. */
      health: z.enum(['not-on-station', 'on-time', 'late', 'silent']),
      /** How often it reports, in minutes, from its template. */
      checkInMinutes: z.number(),
      /** Its ship's crew as the fleet shows it now: its status, when its session last called, since when its crew holds it. */
      crew: z.object({ status: z.enum(['awaitingCrew', 'crewed', 'retired']), lastSeenAt: z.iso.datetime().nullable(), crewedSince: z.iso.datetime().nullable() }),
    }),
  ),
  formedAt: z.iso.datetime(),
  sailedAt: z.iso.datetime().nullable(),
});

/** A squadron as the API states it: never the flagship's crew token. */
function squadronOutputOf(squadron: ListedSquadron): z.infer<typeof squadronOutputSchema> {
  const { repository, name, version, commit } = squadron.blueprint;
  return {
    id: squadron.id,
    state: squadron.state,
    blueprint: { repository, name, version, commit },
    flagship: { shipId: squadron.flagship.shipId, name: squadron.flagship.name },
    members: squadron.members.map((member) => ({
      shipId: member.shipId,
      name: member.name,
      role: member.role,
      type: member.type,
      onStationAt: member.onStationAt?.toISOString() ?? null,
      model: { pinned: pinnedModel(squadron, member), stated: member.checkIn?.model ?? null, isMismatch: isModelMismatch(squadron, member) },
      health: member.health,
      checkInMinutes: member.checkInMinutes,
      crew: {
        status: member.ship.status,
        lastSeenAt: member.ship.lastSeenAt?.toISOString() ?? null,
        crewedSince: member.ship.crewedSince?.toISOString() ?? null,
      },
    })),
    formedAt: squadron.formedAt.toISOString(),
    sailedAt: squadron.sailedAt?.toISOString() ?? null,
  };
}

export const squadronsRouter = t.router({
  connection: t.router({
    /** Whether squadrons is connected, as which ship, and the ship it was last connected as. */
    status: operatorProcedure.output(connectionOutputSchema).query(({ ctx }) => ctx.readConnection()),
    /**
     * Connects squadrons with the management ship's secret, which the web
     * app's server hands over server to server: squadrons registers with it
     * and keeps only the crew token. Only while not connected.
     */
    connect: operatorProcedure
      .input(z.object({ shipId: idSchema('ship'), secret: z.string().min(1) }))
      .output(connectionOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const connected = await ctx.connect({ operatorFleetId: ctx.fleetId, ...input });
        if (!connected.isOk) {
          throw new TRPCError({ code: CONNECT_CODES[connected.error.kind], message: connected.error.message });
        }
        return connected.value;
      }),
  }),
  squadrons: t.router({
    /** The messages a squadron's flagship kept because it does not handle them, oldest first. */
    messages: connectedProcedure
      .input(z.object({ squadronId: z.string() }))
      .output(
        z.array(
          z.object({
            deliveryId: z.string(),
            messageId: z.string(),
            senderShipId: z.string(),
            senderName: z.string(),
            contentType: z.string(),
            payload: z.string(),
            inReplyTo: z.string().nullable(),
            receivedAt: z.iso.datetime(),
          }),
        ),
      )
      .query(async ({ ctx, input }) =>
        (await ctx.keptMessages(ctx.fleetId, input.squadronId)).map((message) => ({
          deliveryId: message.deliveryId,
          messageId: message.messageId,
          senderShipId: message.senderShipId,
          senderName: message.senderName,
          contentType: message.contentType,
          payload: message.payload,
          inReplyTo: message.inReplyTo,
          receivedAt: message.receivedAt.toISOString(),
        })),
      ),
    /** The fleet's squadrons, oldest first, with their members, each with its health and crew as the fleet shows them now. */
    list: connectedProcedure.output(z.array(squadronOutputSchema)).query(async ({ ctx }) => {
      const listed = await ctx.listSquadrons(ctx.fleetId);
      if (!listed.isOk) {
        throw new TRPCError({ code: LIST_CODES[listed.error.kind], message: listed.error.message });
      }
      return listed.value.map(squadronOutputOf);
    }),
    /**
     * Stands a sailing squadron down: it takes no new work, each member on
     * station gets its stand-down and is retired once it acknowledged it and
     * holds no open deliveries, then the flagship is retired and the squadron
     * is Disbanded. The members and the flagship advance at each rescan.
     */
    standDown: connectedProcedure
      .input(z.object({ squadronId: z.string() }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        const stood = await ctx.standDown({ fleetId: ctx.fleetId, squadronId: input.squadronId });
        if (!stood.isOk) {
          throw new TRPCError({ code: STAND_DOWN_CODES[stood.error.kind], message: stood.error.message });
        }
        return {};
      }),
    /**
     * Forces the stand down of a Forming, Sailing or Standing down squadron:
     * every member not retired yet and the flagship are retired at once, their
     * direct deliveries abandoned, and the squadron is Disbanded.
     */
    forceStandDown: connectedProcedure
      .input(z.object({ squadronId: z.string() }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        const forced = await ctx.forceStandDown({ fleetId: ctx.fleetId, squadronId: input.squadronId });
        if (!forced.isOk) {
          throw new TRPCError({ code: FORCE_CODES[forced.error.kind], message: forced.error.message });
        }
        return {};
      }),
    /**
     * Forms a squadron from a blueprint version: its flagship crewed by
     * squadrons, its members commissioned. Each member's crew line, launch
     * note and pinned model are in the answer, once.
     */
    form: connectedProcedure
      .input(z.object({ blueprint: z.object({ repository: z.string(), name: z.string(), version: z.int().min(1) }), squadronId: z.string().optional() }))
      .output(
        z.object({
          squadronId: z.string(),
          flagship: z.object({ shipId: z.string(), name: z.string() }),
          members: z.array(z.object({ shipId: z.string(), name: z.string(), role: z.string(), crewLine: z.string(), launchNote: z.string().nullable(), model: z.string().nullable() })),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const formed = await ctx.formSquadron(input);
        if (!formed.isOk) {
          throw new TRPCError({ code: FORM_CODES[formed.error.kind], message: formed.error.message });
        }
        return formed.value;
      }),
  }),
  catalogue: t.router({
    /** Every template and blueprint version tagged in git, and every version left out with its problem. */
    list: connectedProcedure.output(catalogueOutputSchema).query(({ ctx }) => {
      const { templates, blueprints, problems } = ctx.catalogue();
      return {
        templates: templates.map((template) => ({ ...template, committedAt: template.committedAt.toISOString() })),
        blueprints: blueprints.map((blueprint) => ({ ...blueprint, committedAt: blueprint.committedAt.toISOString() })),
        problems,
      };
    }),
    /** Fetches the repositories again now, rather than at the next interval. */
    refresh: connectedProcedure.output(z.strictObject({})).mutation(async ({ ctx }) => {
      await ctx.refreshCatalogue();
      return {};
    }),
  }),
});

export type SquadronsRouter = typeof squadronsRouter;
