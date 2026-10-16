/** The operator's email: at most 254 characters, the longest address mail carries. */
export const OPERATOR_EMAIL_MAX_LENGTH = 254;

/** The bound only keeps an absurd input from reaching the password hash. */
export const OPERATOR_PASSWORD_MAX_LENGTH = 1024;

/**
 * A new operator password (fleet:init, operator:reset-password) is at least
 * this long. Sign-in checks no minimum, so a shorter password set before
 * still signs in.
 */
export const OPERATOR_PASSWORD_MIN_LENGTH = 12;

export const EMAIL_REQUIRED = 'Enter your email';
export const EMAIL_TOO_LONG = `Use an email of at most ${String(OPERATOR_EMAIL_MAX_LENGTH)} characters`;
export const PASSWORD_REQUIRED = 'Enter your password';
export const PASSWORD_TOO_LONG = `Use a password of at most ${String(OPERATOR_PASSWORD_MAX_LENGTH)} characters`;
export const PASSWORD_TOO_SHORT = `Use a password of at least ${String(OPERATOR_PASSWORD_MIN_LENGTH)} characters`;

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

/** What is wrong with a new operator password, taken exactly as typed; undefined when nothing is. */
export function newOperatorPasswordProblem(password: string): string | undefined {
  if (password.length < OPERATOR_PASSWORD_MIN_LENGTH) {
    return PASSWORD_TOO_SHORT;
  }
  return password.length > OPERATOR_PASSWORD_MAX_LENGTH ? PASSWORD_TOO_LONG : undefined;
}
