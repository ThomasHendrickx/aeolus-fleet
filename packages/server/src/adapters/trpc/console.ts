import {
  accountOutputSchema,
  consoleSessionOutputSchema,
  setThemeInputSchema,
  setThemeOutputSchema,
  signInInputSchema,
} from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import { deviceLabelOf } from '../http/device-label.js';
import { authenticatedProcedure, ConsoleRefusalDetails, consoleProcedure, okOrThrow, publicProcedure, router } from './trpc.js';

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

  /** The signed-in operator: email, theme, and this console session's device and start. */
  account: authenticatedProcedure.output(accountOutputSchema).query(async ({ ctx }) => {
    const account = okOrThrow(await ctx.useCases.readAccount(ctx.caller));
    return { ...account, session: { ...account.session, since: account.session.since.toISOString() } };
  }),

  /**
   * Whether the request carries a signed-in console session: for another
   * service the operator uses beside the console (decision 0012), which
   * forwards the browser's cookie from its own server and serves its pages
   * without a login of its own. Only the cookie counts, never a crew token:
   * a ship is no operator. Counts as console use, so the session's expiry
   * moves as on any console call. A query: it comes from any origin.
   */
  session: publicProcedure.output(consoleSessionOutputSchema).query(async ({ ctx }) => {
    const { sessionToken } = ctx.credentials;
    const use = sessionToken === undefined ? undefined : await ctx.useCases.authenticate.byConsoleSession(sessionToken);
    if (!use) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No signed-in console session' });
    }
    return { fleetId: use.caller.fleetId, expiresAt: use.expiresAt.toISOString() };
  }),

  /** Stores the operator's theme on their account, so it follows them to any browser. */
  setTheme: authenticatedProcedure
    .input(setThemeInputSchema)
    .output(setThemeOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.setTheme(ctx.caller, input));
      return {};
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
