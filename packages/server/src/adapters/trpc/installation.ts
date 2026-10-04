import { timingSafeEqual } from 'node:crypto';

import {
  installationFleetSchema,
  installationFleetsCreateInputSchema,
  installationFleetsCreateOutputSchema,
  installationFleetsDeleteInputSchema,
  installationFleetsDeleteOutputSchema,
  installationFleetsGetInputSchema,
  installationFleetsListOutputSchema,
} from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import type { InstallationFleet } from '../../core/registry/installation-fleet.js';
import type { InstallationCredential } from './context.js';
import { okOrThrow, publicProcedure, router } from './trpc.js';

/** The header a hosting service presents the installation token in: apart from a crew token and a console session. */
export const INSTALLATION_TOKEN_HEADER = 'x-aeolus-installation-token';

/** Whether the presented token is the configured one, compared in constant time. */
function isInstallationToken(credential: InstallationCredential & { configured: string }): boolean {
  const configured = Buffer.from(credential.configured);
  const presented = Buffer.from(credential.presented ?? '');
  return presented.length === configured.length && timingSafeEqual(presented, configured);
}

/**
 * A procedure of the installation (docs/architecture.md, "Installation"):
 * off without a configured installation token, where it answers as a path the
 * server does not serve, so a self-hosted server shows nothing new; with one,
 * only a request presenting that token passes. Never a crew token or console
 * session: the caller is the installation, not a ship.
 */
const installationProcedure = publicProcedure.use(({ ctx, next }) => {
  const { configured, presented } = ctx.installation;
  if (configured === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No such procedure' });
  }
  if (!isInstallationToken({ configured, presented })) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: `Call with the installation token in ${INSTALLATION_TOKEN_HEADER}` });
  }
  return next();
});

function described(fleet: InstallationFleet) {
  return { ...fleet, createdAt: fleet.createdAt.toISOString(), lastActivityAt: fleet.lastActivityAt?.toISOString() ?? null };
}

/** The installation's fleets: what a service hosting many fleets on this server calls, never a ship. */
export const installationRouter = router({
  fleets: router({
    /** Creates a fleet, its argo and its operator without a password; once per request id. */
    create: installationProcedure
      .input(installationFleetsCreateInputSchema)
      .output(installationFleetsCreateOutputSchema)
      .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.createFleet(input))),

    /** Every fleet, oldest first, with its operator, ships, messages of the last 7 days and last activity. */
    list: installationProcedure
      .output(installationFleetsListOutputSchema)
      .query(async ({ ctx }) => (await ctx.useCases.listInstallationFleets()).map(described)),

    /** One fleet, described as the list describes it. */
    get: installationProcedure
      .input(installationFleetsGetInputSchema)
      .output(installationFleetSchema)
      .query(async ({ ctx, input }) => described(okOrThrow(await ctx.useCases.getInstallationFleet(input)))),

    /**
     * Deletes a fleet and every record in it, for good; once per request id.
     * No event survives it, so the server logs it.
     */
    delete: installationProcedure
      .input(installationFleetsDeleteInputSchema)
      .output(installationFleetsDeleteOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const deleted = okOrThrow(await ctx.useCases.deleteFleet(input));
        if (!deleted.isReplay) {
          const { fleetId, name, operatorEmail } = deleted;
          ctx.log.info({ requestId: input.requestId, fleetId, name, operatorEmail }, 'installation deleted a fleet');
        }
        return {};
      }),
  }),
});
