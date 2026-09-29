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
 * Input of `console.signIn`: the operator's email and password. Whitespace
 * around the email is dropped; the password is taken exactly as typed. The
 * email's shape is not checked here: an email the server does not know is
 * simply wrong, like a wrong password.
 */
export const signInInputSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').max(OPERATOR_EMAIL_MAX_LENGTH),
  password: z.string().min(1, 'Enter your password').max(OPERATOR_PASSWORD_MAX_LENGTH),
});

export type SignInInput = z.infer<typeof signInInputSchema>;
