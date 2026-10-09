/** The operator's email: at most 254 characters, the longest address mail carries. */
export const OPERATOR_EMAIL_MAX_LENGTH = 254;

/**
 * Any operator password up to this length: no strength rules (ADR 0016). The
 * bound only keeps an absurd input from reaching the password hash.
 */
export const OPERATOR_PASSWORD_MAX_LENGTH = 1024;

export const EMAIL_REQUIRED = 'Enter your email';
export const EMAIL_TOO_LONG = `Use an email of at most ${String(OPERATOR_EMAIL_MAX_LENGTH)} characters`;
export const PASSWORD_REQUIRED = 'Enter your password';
export const PASSWORD_TOO_LONG = `Use a password of at most ${String(OPERATOR_PASSWORD_MAX_LENGTH)} characters`;

/** What is wrong with a sign-in email, whitespace around it dropped; undefined when nothing is. */
export function signInEmailProblem(email: string): string | undefined {
  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return EMAIL_REQUIRED;
  }
  return trimmed.length > OPERATOR_EMAIL_MAX_LENGTH ? EMAIL_TOO_LONG : undefined;
}

/** What is wrong with a sign-in password, taken exactly as typed; undefined when nothing is. */
export function signInPasswordProblem(password: string): string | undefined {
  if (password.length === 0) {
    return PASSWORD_REQUIRED;
  }
  return password.length > OPERATOR_PASSWORD_MAX_LENGTH ? PASSWORD_TOO_LONG : undefined;
}
