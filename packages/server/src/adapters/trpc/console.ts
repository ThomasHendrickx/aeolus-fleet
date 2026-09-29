import { signInInputSchema } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import { okOrThrow, publicProcedure, router } from './trpc.js';

/**
 * Console procedures: the only ones that exist for the web app alone. They take
 * `argo`'s secret once and work with the session cookie from then on.
 */
export const consoleRouter = router({
  /** Exchanges argo's secret for a session cookie. A mutation, so the secret travels in the body, never the URL. */
  signIn: publicProcedure
    .use(({ ctx, next }) => {
      if (!ctx.takeSignInAttempt(ctx.clientKey)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many sign-in attempts. Wait a minute.' });
      }
      return next();
    })
    .input(signInInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { token, expiresAt } = okOrThrow(await ctx.useCases.signIn({ secret: input.secret }));
      ctx.sessionCookie.set(token, expiresAt);
    }),

  /** Ends the console session in the cookie and releases argo's lease. Always clears the cookie. */
  signOut: publicProcedure.mutation(async ({ ctx }) => {
    const { sessionToken } = ctx.credentials;
    const use = sessionToken === undefined ? undefined : await ctx.useCases.authenticate.byConsoleSession(sessionToken);
    if (use) {
      await ctx.useCases.signOut(use.caller);
    }
    ctx.sessionCookie.clear();
  }),
});
