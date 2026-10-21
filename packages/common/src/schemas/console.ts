import { z } from 'zod';

import { scopeSchema } from '../fleet/index.js';
import { idSchema } from '../ids/index.js';
import { accountIdSchema } from './account-token.js';
import {
  EMAIL_REQUIRED,
  EMAIL_TOO_LONG,
  OPERATOR_EMAIL_MAX_LENGTH,
  OPERATOR_PASSWORD_MAX_LENGTH,
  OPERATOR_PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIRED,
  PASSWORD_TOO_LONG,
  PASSWORD_TOO_SHORT,
} from '../rules/sign-in.js';

/** One @ with something on each side, and no whitespace. */
export const OPERATOR_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
export { newOperatorPasswordProblem, OPERATOR_EMAIL_MAX_LENGTH, OPERATOR_PASSWORD_MAX_LENGTH } from '../rules/sign-in.js';

/**
 * Input of `console.signIn`: the operator's email and password. Whitespace
 * around the email is dropped; the password is taken exactly as typed. The
 * email's shape is not checked here: an email the server does not know is
 * simply wrong, like a wrong password.
 */
export const signInInputSchema = z.object({
  email: z.string().trim().min(1, EMAIL_REQUIRED).max(OPERATOR_EMAIL_MAX_LENGTH, EMAIL_TOO_LONG),
  password: z.string().min(1, PASSWORD_REQUIRED).max(OPERATOR_PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG),
});

export type SignInInput = z.infer<typeof signInInputSchema>;

/** The longest sign-in ticket the console takes: far longer than any the server issues. */
const SIGN_IN_TICKET_MAX_LENGTH = 256;

/**
 * A one-time sign-in ticket a hosting installation issued for the operator
 * (docs/blueprint.md, "Installation"): the console redeems it for a session,
 * as a password sign-in does.
 */
export const redeemSignInTicketInputSchema = z.strictObject({ ticket: z.string().min(1).max(SIGN_IN_TICKET_MAX_LENGTH) });

/** The console's theme, per operator account: Light, Dark, or System (the browser's setting), the default. */
export const THEMES = ['light', 'dark', 'system'] as const;
export const themeSchema = z.enum(THEMES);
export type Theme = z.infer<typeof themeSchema>;

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/** Whose a console session is: the operator's, crewing argo, or a viewer's, through the viewer ship (decision 0022). */
export const consoleSessionKindSchema = z.enum(['operator', 'viewer']);

/**
 * Output of `console.session`: for another service the operator uses beside
 * the console, which forwards the browser's session cookie and asks whether
 * someone is signed in. The fleet, when the session expires (ISO 8601 in
 * UTC), whose session it is, and the scopes of its ship: a viewer reads only.
 */
export const consoleSessionOutputSchema = z.object({
  fleetId: idSchema('fleet'),
  expiresAt: z.iso.datetime(),
  kind: consoleSessionKindSchema,
  scopes: z.array(scopeSchema),
});

export type ConsoleSessionOutput = z.infer<typeof consoleSessionOutputSchema>;

/** This console session: its device, since when, and the account that signed in as argo, by its id, or none (decision 0054). */
const accountSessionSchema = z.object({ device: z.string(), since: isoTime, accountId: accountIdSchema.nullable().optional() });

/**
 * Output of `console.account`: the signed-in operator, their theme, and this
 * console session: the device it signed in from and since when. A viewer's
 * session has no email and no theme (decision 0022).
 */
export const accountOutputSchema = z.discriminatedUnion('kind', [
  // No email until argo sets one in Settings: fleet:init gives its own sign-in none (accounts design, A1).
  z.object({ kind: z.literal('operator'), email: z.string().nullable(), theme: themeSchema, hasPassword: z.boolean(), session: accountSessionSchema }),
  z.object({ kind: z.literal('viewer'), session: accountSessionSchema }),
]);

export type Account = z.infer<typeof accountOutputSchema>;

/** Input of `console.setTheme`. */
export const setThemeInputSchema = z.object({ theme: themeSchema });

/**
 * Input of `console.setLogin`: the email and new password of argo's own
 * sign-in, on a self-hosted fleet (accounts design, A1), with the current
 * password while argo has one. Whitespace around the email is dropped; the
 * server checks its shape and that no other operator signs in with it. The
 * passwords are taken exactly as typed.
 */
export const setLoginInputSchema = z.object({
  email: z.string().trim().min(1, EMAIL_REQUIRED).max(OPERATOR_EMAIL_MAX_LENGTH, EMAIL_TOO_LONG),
  password: z.string().min(OPERATOR_PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT).max(OPERATOR_PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG),
  currentPassword: z.string().max(OPERATOR_PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG).optional(),
});

export type SetLoginInput = z.infer<typeof setLoginInputSchema>;

/** Output of `console.setLogin`: nothing; the OK is the answer. */
export const setLoginOutputSchema = z.strictObject({});

/** Output of `console.setTheme`: nothing; the OK is the answer. */
export const setThemeOutputSchema = z.strictObject({});
