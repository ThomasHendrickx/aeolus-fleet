/**
 * squadrons' API: one tRPC router, which the web app's server calls with the
 * console's session cookie (decision 0017). Every procedure is the
 * operator's: the cookie must be a signed-in console session of the fleet
 * squadrons serves.
 */
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Catalogue } from '../../core/catalogue/catalogue.js';
import type { AuthenticateOperator } from '../../core/operator/authenticate-operator.js';
import type { FormSquadron } from '../../core/squadron/form-squadron.js';
import type { Squadron } from '../../core/squadron/squadron.js';
import type { FleetId } from '@aeolus-fleet/common';

export interface Context {
  /** The Cookie header the web app's server forwarded. */
  cookie: string | undefined;
  authenticateOperator: AuthenticateOperator;
  catalogue: () => Catalogue;
  refreshCatalogue: () => Promise<void>;
  formSquadron: FormSquadron;
  listSquadrons: (fleetId: FleetId) => Promise<Squadron[]>;
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

/** The refusals of forming, as the API states them. */
const FORM_CODES = {
  BLUEPRINT_NOT_FOUND: 'NOT_FOUND',
  INVALID_SQUADRON_ID: 'BAD_REQUEST',
  SQUADRON_ID_TAKEN: 'CONFLICT',
  MANAGEMENT_SHIP_NOT_CREWED: 'PRECONDITION_FAILED',
  FORMING_FAILED: 'BAD_GATEWAY',
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
      entry: z.string(),
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
  members: z.array(z.object({ shipId: z.string(), name: z.string(), role: z.string(), type: z.string(), onStationAt: z.iso.datetime().nullable() })),
  formedAt: z.iso.datetime(),
  sailedAt: z.iso.datetime().nullable(),
});

/** A squadron as the API states it: never the flagship's crew token. */
function squadronOutputOf(squadron: Squadron): z.infer<typeof squadronOutputSchema> {
  const { repository, name, version, commit } = squadron.blueprint;
  return {
    id: squadron.id,
    state: squadron.state,
    blueprint: { repository, name, version, commit },
    flagship: { shipId: squadron.flagship.shipId, name: squadron.flagship.name },
    members: squadron.members.map((member) => ({ ...member, onStationAt: member.onStationAt?.toISOString() ?? null })),
    formedAt: squadron.formedAt.toISOString(),
    sailedAt: squadron.sailedAt?.toISOString() ?? null,
  };
}

export const squadronsRouter = t.router({
  squadrons: t.router({
    /** The fleet's squadrons, oldest first, with their members and whether each is on station. */
    list: operatorProcedure.output(z.array(squadronOutputSchema)).query(async ({ ctx }) => (await ctx.listSquadrons(ctx.fleetId)).map(squadronOutputOf)),
    /**
     * Forms a squadron from a blueprint version: its flagship crewed by
     * squadrons, its members commissioned. Each member's crew line and launch
     * note are in the answer, once.
     */
    form: operatorProcedure
      .input(z.object({ blueprint: z.object({ repository: z.string(), name: z.string(), version: z.int().min(1) }), squadronId: z.string().optional() }))
      .output(
        z.object({
          squadronId: z.string(),
          flagship: z.object({ shipId: z.string(), name: z.string() }),
          members: z.array(z.object({ shipId: z.string(), name: z.string(), role: z.string(), crewLine: z.string(), launchNote: z.string().nullable() })),
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
    list: operatorProcedure.output(catalogueOutputSchema).query(({ ctx }) => {
      const { templates, blueprints, problems } = ctx.catalogue();
      return {
        templates: templates.map((template) => ({ ...template, committedAt: template.committedAt.toISOString() })),
        blueprints: blueprints.map((blueprint) => ({ ...blueprint, committedAt: blueprint.committedAt.toISOString() })),
        problems,
      };
    }),
    /** Fetches the repositories again now, rather than at the next interval. */
    refresh: operatorProcedure.output(z.strictObject({})).mutation(async ({ ctx }) => {
      await ctx.refreshCatalogue();
      return {};
    }),
  }),
});

export type SquadronsRouter = typeof squadronsRouter;
