import { z } from 'zod';

import { idSchema } from '../ids/index.js';

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

/** The console's theme, per operator account: Light, Dark, or System (the browser's setting), the default. */
export const THEMES = ['light', 'dark', 'system'] as const;
export const themeSchema = z.enum(THEMES);
export type Theme = z.infer<typeof themeSchema>;

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/**
 * Output of `console.session`: for another service the operator uses beside
 * the console, which forwards the browser's session cookie and asks whether
 * the operator is signed in. The fleet they signed in to, and when the
 * session expires (ISO 8601 in UTC).
 */
export const consoleSessionOutputSchema = z.object({
  fleetId: idSchema('fleet'),
  expiresAt: z.iso.datetime(),
});

export type ConsoleSessionOutput = z.infer<typeof consoleSessionOutputSchema>;

/**
 * Output of `console.account`: the signed-in operator, their theme, and this
 * console session: the device it signed in from and since when.
 */
export const accountOutputSchema = z.object({
  email: z.string(),
  theme: themeSchema,
  session: z.object({ device: z.string(), since: isoTime }),
});

export type Account = z.infer<typeof accountOutputSchema>;

/** Input of `console.setTheme`. */
export const setThemeInputSchema = z.object({ theme: themeSchema });

/** Output of `console.setTheme`: nothing; the OK is the answer. */
export const setThemeOutputSchema = z.strictObject({});
