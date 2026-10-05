import { timingSafeEqual } from 'node:crypto';

import {
  installationFleetSchema,
  installationFleetsCreateInputSchema,
  installationFleetsCreateOutputSchema,
  installationFleetsDeleteInputSchema,
  installationFleetsDeleteOutputSchema,
  installationFleetsGetInputSchema,
  installationFleetsListOutputSchema,
  installationFleetLimitsSchema,
  installationFleetsSetLimitsInputSchema,
  installationOperatorsIssueSignInTicketInputSchema,
  installationOperatorsIssueSignInTicketOutputSchema,
  installationSettingsSchema,
  guideOutputSchema,
  noticesOutputSchema,
  setGuideInputSchema,
  setNoticesInputSchema,
} from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import type { Guide, GuideStep } from '../../core/identity/guide.js';
import type { Notice } from '../../core/identity/notice.js';
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

/** A guide's steps as the API answers them. */
export function guideStepsOutputOf(steps: readonly GuideStep[]): GuideStep[] {
  return steps.map((step) => ({ ...step }));
}

/** The guide as the API answers it, or null. */
function guideOutputOf(guide: Guide | null): { guide: (Omit<Guide, 'steps'> & { steps: GuideStep[] }) | null } {
  return { guide: guide === null ? null : { ...guide, steps: guideStepsOutputOf(guide.steps) } };
}

/** A notice as the API answers it. */
export function noticeOutputOf(notice: Notice): Notice & { links: Notice['links'][number][] } {
  return { ...notice, links: [...notice.links] };
}

/** The installation's fleets: what a service hosting many fleets on this server calls, never a ship. */
export const installationRouter = router({
  settings: router({
    /** The default ship and daily message limits for fleets and the cap on fleets; null is no limit. */
    get: installationProcedure.output(installationSettingsSchema).query(({ ctx }) => ctx.useCases.getInstallationSettings()),

    /** Sets all three; a change to a default applies at once to every fleet that follows it. */
    set: installationProcedure
      .input(installationSettingsSchema)
      .output(installationSettingsSchema)
      .mutation(async ({ ctx, input }) => {
        const settings = okOrThrow(await ctx.useCases.setInstallationSettings(input));
        ctx.log.info({ ...settings }, 'installation settings set');
        return settings;
      }),
  }),
  guide: router({
    /** The guide the console shows (decision 0024), or null. */
    get: installationProcedure.output(guideOutputSchema).query(async ({ ctx }) => guideOutputOf(await ctx.useCases.getGuide())),

    /** Replaces the guide with this one; null clears it. */
    set: installationProcedure
      .input(setGuideInputSchema)
      .output(guideOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const guide = await ctx.useCases.setGuide(input);
        ctx.log.info({ guide: guide === null ? null : { audience: guide.audience, steps: guide.steps.length } }, 'installation guide set');
        return guideOutputOf(guide);
      }),
  }),

  notices: router({
    /** The notices the console shows (decision 0023), in their order. */
    get: installationProcedure.output(noticesOutputSchema).query(async ({ ctx }) => ({ notices: (await ctx.useCases.getNotices()).map(noticeOutputOf) })),

    /** Replaces every notice with these, in this order; an empty list clears them. */
    set: installationProcedure
      .input(setNoticesInputSchema)
      .output(noticesOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const notices = await ctx.useCases.setNotices(input);
        ctx.log.info({ notices: notices.map(({ id, audience }) => ({ id, audience })) }, 'installation notices set');
        return { notices: notices.map(noticeOutputOf) };
      }),
  }),
  fleets: router({
    /** A fleet's limits: how each is set and the limit that applies. */
    limits: installationProcedure
      .input(installationFleetsGetInputSchema)
      .output(installationFleetLimitsSchema)
      .query(async ({ ctx, input }) => okOrThrow(await ctx.useCases.getFleetLimits(input))),

    /** Sets one or both of a fleet's limits, to a number or to no limit for the fleet, or back to the default. */
    setLimits: installationProcedure
      .input(installationFleetsSetLimitsInputSchema)
      .output(installationFleetLimitsSchema)
      .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.setFleetLimits(input))),

    /** Creates a fleet, its argo and its operator without a password; once per request id. */
    create: installationProcedure
      .input(installationFleetsCreateInputSchema)
      .output(installationFleetsCreateOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const { viewer, ...fleet } = input;
        return okOrThrow(await ctx.useCases.createFleet({ ...fleet, hasViewer: viewer === true }));
      }),

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
  operators: router({
    /** A one-time sign-in ticket for the fleet's operator, or for a viewer through its viewer ship: single use, valid 2 minutes, redeemed in the console. */
    issueSignInTicket: installationProcedure
      .input(installationOperatorsIssueSignInTicketInputSchema)
      .output(installationOperatorsIssueSignInTicketOutputSchema)
      .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.issueSignInTicket(input))),
  }),
});
