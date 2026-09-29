import type { CredentialId, FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import type { CredentialRepository } from './ports.js';

/** Versioned prefix of every ship secret (ADR 0002). */
export const SHIP_SECRET_PREFIX = 'aeolus_sk_v1_';

/** A ship secret, stored only as its hash. At most one valid secret per ship. */
export interface Credential {
  id: CredentialId;
  fleetId: FleetId;
  shipId: ShipId;
  secretHash: string;
  issuedAt: Date;
  claimedAt: Date | null;
  invalidatedAt: Date | null;
}

export interface CredentialTx {
  credentials: CredentialRepository;
}

export interface SecretTools {
  hasher: SecretHasher;
  random: RandomTokens;
  ids: IdGenerator;
}

/**
 * Issues a new secret for a ship and stores only its hash. The caller
 * invalidates any earlier secret first. Returns the secret: the one moment it
 * exists in plain text.
 */
export async function issueShipSecret(
  deps: SecretTools & { tx: CredentialTx },
  input: { fleetId: FleetId; shipId: ShipId; at: Date },
): Promise<string> {
  const secret = SHIP_SECRET_PREFIX + deps.random.next();
  await deps.tx.credentials.create({
    id: deps.ids('credential'),
    fleetId: input.fleetId,
    shipId: input.shipId,
    secretHash: deps.hasher.hash(secret),
    issuedAt: input.at,
    claimedAt: null,
    invalidatedAt: null,
  });
  return secret;
}
