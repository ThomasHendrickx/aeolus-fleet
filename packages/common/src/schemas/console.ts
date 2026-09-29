import { z } from 'zod';

/**
 * Input of `console.signIn`: argo's secret, pasted by the operator. Whitespace
 * around it is dropped, because a pasted secret often carries a newline.
 */
export const signInInputSchema = z.object({
  secret: z.string().trim().min(1, "Paste argo's secret").max(256),
});

export type SignInInput = z.infer<typeof signInInputSchema>;
