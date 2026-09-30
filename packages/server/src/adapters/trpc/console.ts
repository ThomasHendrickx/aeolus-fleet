import { signInInputSchema } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import { consoleProcedure, okOrThrow, router } from './trpc.js';

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
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many sign-in attempts. Wait a minute.' });
      }
      return next();
    })
    .input(signInInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { token, expiresAt } = okOrThrow(await ctx.useCases.signIn(input));
      ctx.sessionCookie.set(token, expiresAt);
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
