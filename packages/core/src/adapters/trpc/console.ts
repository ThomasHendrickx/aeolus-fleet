import {
  accountOutputSchema,
  consoleGuideOutputSchema,
  consoleNoticesOutputSchema,
  consoleSessionOutputSchema,
  dismissNoticeInputSchema,
  setGuideProgressInputSchema,
  setThemeInputSchema,
  setThemeOutputSchema,
  redeemSignInTicketInputSchema,
  signInInputSchema,
} from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import { deviceLabelOf } from '../http/device-label.js';
import { guideStepsOutputOf, noticeOutputOf } from './installation.js';
import { authenticatedProcedure, ConsoleRefusalDetails, consoleProcedure, okOrThrow, publicProcedure, refuseIfSignedInElsewhere, router } from './trpc.js';

/**
 * Console procedures: the only ones that exist for the web app alone. They take
 * the operator's email and password once and work with the session cookie,
 * which crews `argo`, from then on. Both change state, so both come only from
 * the console's origin.
 */
export const consoleRouter = router({
  /** Exchanges the email and password for a session cookie. A mutation, so the password travels in the body, never the URL. */
  signIn: consoleProcedure
    .use(({ ctx, next }) => {
      if (!ctx.takeSignInAttempt(ctx.clientKey)) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many sign-in attempts. Wait a minute.',
          cause: new ConsoleRefusalDetails({ retryAt: ctx.signInRetryAt(ctx.clientKey).toISOString() }),
        });
      }
      return next();
    })
    .input(signInInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { token, expiresAt } = okOrThrow(await ctx.useCases.signIn({ ...input, device: deviceLabelOf(ctx.userAgent) }));
      ctx.sessionCookie.set(token, expiresAt);
    }),

  /**
   * Exchanges a sign-in ticket a hosting installation issued for a session
   * cookie, as a password sign-in does (docs/blueprint.md, "Installation"). The
   * console's own server calls it with the browser's ticket and passes the
   * cookie on, so it takes no console origin: the ticket is the credential,
   * and it signs in once.
   */
  redeemSignInTicket: publicProcedure.input(redeemSignInTicketInputSchema).mutation(async ({ ctx, input }) => {
    const { token, expiresAt } = okOrThrow(await ctx.useCases.redeemSignInTicket({ ...input, device: deviceLabelOf(ctx.userAgent) }));
    ctx.sessionCookie.set(token, expiresAt);
  }),

  /** The signed-in operator: email, theme, and this console session's device and start; a viewer's session alone. */
  account: authenticatedProcedure.output(accountOutputSchema).query(async ({ ctx }) => {
    const account = okOrThrow(await ctx.useCases.readAccount(ctx.caller));
    return { ...account, session: { ...account.session, since: account.session.since.toISOString() } };
  }),

  /**
   * Whether the request carries a signed-in console session: for another
   * service the operator uses beside the console (decision 0012), which
   * forwards the browser's cookie from its own server and serves its pages
   * without a login of its own. Only the cookie counts, never a crew token:
   * a ship is no operator. Says whose session it is, the operator's or a
   * viewer's, and its ship's scopes, so that service serves a viewer reads
   * only; refuses a session a sign-in elsewhere ended saying so, as any call
   * does, so that service can say so too. Counts as console use, so the session's expiry moves as on any
   * console call. A query: it comes from any origin.
   */
  session: publicProcedure.output(consoleSessionOutputSchema).query(async ({ ctx }) => {
    const { sessionToken } = ctx.credentials;
    const use = sessionToken === undefined ? undefined : await ctx.useCases.authenticate.byConsoleSession(sessionToken);
    if (!use) {
      if (sessionToken !== undefined) {
        await refuseIfSignedInElsewhere(ctx, sessionToken);
      }
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No signed-in console session' });
    }
    const { fleetId, kind, scopes } = use.caller;
    if (kind === 'agent') {
      // A console session is the operator's or a viewer's; no agent ever signs in to the console.
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No signed-in console session' });
    }
    return { fleetId, expiresAt: use.expiresAt.toISOString(), kind, scopes: [...scopes] };
  }),

  /** Stores the operator's theme on their account, so it follows them to any browser. */
  setTheme: authenticatedProcedure
    .input(setThemeInputSchema)
    .output(setThemeOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.setTheme(ctx.caller, input));
      return {};
    }),

  /** The notices this console session shows above every page (decision 0023): those of its audience it has not dismissed. */
  notices: authenticatedProcedure.output(consoleNoticesOutputSchema).query(async ({ ctx }) => (await ctx.useCases.readNotices(ctx.caller)).map(noticeOutputOf)),

  /** The guide this console session shows (decision 0024), with where it is in it; null when no guide is for its audience. */
  guide: authenticatedProcedure.output(consoleGuideOutputSchema).query(async ({ ctx }) => {
    const guide = await ctx.useCases.readGuide(ctx.caller);
    return guide === null ? null : { steps: guideStepsOutputOf(guide.steps), progress: guide.progress };
  }),

  /** Records where this console session is in the guide, for itself only. */
  recordGuideProgress: authenticatedProcedure.input(setGuideProgressInputSchema).mutation(async ({ ctx, input }) => {
    okOrThrow(await ctx.useCases.recordGuideProgress(ctx.caller, input));
  }),

  /** Dismisses a dismissible notice for this console session only. */
  dismissNotice: authenticatedProcedure.input(dismissNoticeInputSchema).mutation(async ({ ctx, input }) => {
    okOrThrow(await ctx.useCases.dismissNotice(ctx.caller, input));
  }),

  /** Ends the console session in the cookie and releases argo's lease. Always clears the cookie. */
  signOut: consoleProcedure.mutation(async ({ ctx }) => {
    const { sessionToken } = ctx.credentials;
    const use = sessionToken === undefined ? undefined : await ctx.useCases.authenticate.byConsoleSession(sessionToken);
    if (use) {
      await ctx.useCases.signOut(use.caller);
    }
    ctx.sessionCookie.clear();
  }),
});
