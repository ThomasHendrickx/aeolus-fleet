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

export interface Context {
  /** The Cookie header the web app's server forwarded. */
  cookie: string | undefined;
  authenticateOperator: AuthenticateOperator;
  catalogue: () => Catalogue;
  refreshCatalogue: () => Promise<void>;
}

const t = initTRPC.context<Context>().create({ isDev: false });

const operatorProcedure = t.procedure.use(async ({ ctx, next }) => {
  const operator = await ctx.authenticateOperator(ctx.cookie);
  if (!operator.isOk) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: operator.error.message });
  }
  return next();
});

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

export const squadronsRouter = t.router({
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
