import {
  OPERATOR_EMAIL_MAX_LENGTH,
  OPERATOR_EMAIL_PATTERN,
  OPERATOR_PASSWORD_MAX_LENGTH,
  type FleetId,
  type OperatorId,
  type Theme,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * The operator's login (ADR 0012): signing in with its email and password
 * crews `argo`. One account per fleet in v1. Only the Argon2id hash of the
 * password is stored, and an operator may have no password at all.
 */
export interface OperatorAccount {
  id: OperatorId;
  fleetId: FleetId;
  /** Normalised: unique across the installation, found before the fleet is known (ADR 0007). */
  email: string;
  /**
   * The Argon2id hash of the password; null for an operator who has none,
   * such as one a hosting installation created, who signs in another way.
   */
  passwordHash: string | null;
  /** How the console looks for this operator; System until they choose. */
  theme: Theme;
  createdAt: Date;
}

/** The form an email is stored and found in: without the spaces around it, in lowercase. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** An operator email, normalised: one @ with something on each side, no whitespace, at most 254 characters. */
export function operatorEmail(raw: string): Result<string, DomainError<'INVALID_EMAIL'>> {
  const email = normaliseEmail(raw);
  return email.length <= OPERATOR_EMAIL_MAX_LENGTH && OPERATOR_EMAIL_PATTERN.test(email)
    ? ok(email)
    : refuse(
        'INVALID_EMAIL',
        `An operator email is an address like name@example.com, at most ${String(OPERATOR_EMAIL_MAX_LENGTH)} characters`,
      );
}

/** Any password of 1 to 1024 characters, kept exactly as typed: no strength rules (ADR 0016). */
export function operatorPassword(raw: string): Result<string, DomainError<'INVALID_PASSWORD'>> {
  return raw.length > 0 && raw.length <= OPERATOR_PASSWORD_MAX_LENGTH
    ? ok(raw)
    : refuse('INVALID_PASSWORD', `A password is 1 to ${String(OPERATOR_PASSWORD_MAX_LENGTH)} characters`);
}
