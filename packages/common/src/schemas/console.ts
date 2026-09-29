import { z } from 'zod';

/** The operator's email: at most 254 characters, the longest address mail carries. */
export const OPERATOR_EMAIL_MAX_LENGTH = 254;
/** One @ with something on each side, and no whitespace. */
export const OPERATOR_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
/**
 * Any operator password up to this length: no strength rules (ADR 0016). The
 * bound only keeps an absurd input from reaching the password hash.
 */
export const OPERATOR_PASSWORD_MAX_LENGTH = 1024;

/**
 * Input of `console.signIn`: argo's secret, pasted by the operator. Whitespace
 * around it is dropped, because a pasted secret often carries a newline.
 */
export const signInInputSchema = z.object({
  secret: z.string().trim().min(1, "Paste argo's secret").max(256),
});

export type SignInInput = z.infer<typeof signInInputSchema>;
