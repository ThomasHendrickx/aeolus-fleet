import type { CredentialId, FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { recordEvent, type Actor, type EventLog } from '../shared/events.js';
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

export interface IssuedShipSecret {
  /** The secret in plain text: the one moment it exists. */
  secret: string;
  credentialId: CredentialId;
}

/**
 * Issues a new secret for a ship and stores only its hash. The caller
 * invalidates any earlier secret first.
 */
export async function issueShipSecret(
  deps: SecretTools & { tx: CredentialTx },
  input: { fleetId: FleetId; shipId: ShipId; at: Date },
): Promise<IssuedShipSecret> {
  const secret = SHIP_SECRET_PREFIX + deps.random.next();
  const credentialId = deps.ids('credential');
  await deps.tx.credentials.create({
    id: credentialId,
    fleetId: input.fleetId,
    shipId: input.shipId,
    secretHash: deps.hasher.hash(secret),
    issuedAt: input.at,
    claimedAt: null,
    invalidatedAt: null,
  });
  return { secret, credentialId };
}

/**
 * Invalidates the ship's valid secret, if it has one, and writes
 * CredentialRevoked. The secret fails on the very next call.
 */
export async function revokeShipSecret(
  deps: { tx: CredentialTx & { events: EventLog }; ids: IdGenerator },
  input: { fleetId: FleetId; shipId: ShipId; actor: Actor; at: Date },
): Promise<void> {
  const { tx, ids } = deps;
  const { fleetId, shipId, actor, at } = input;

  const valid = await tx.credentials.findValidForShipForUpdate(fleetId, shipId);
  if (!valid) {
    return;
  }
  await tx.credentials.invalidate({ fleetId, credentialId: valid.id, at });
  await recordEvent({ events: tx.events, ids }, {
    fleetId,
    type: 'CredentialRevoked',
    occurredAt: at,
    actor,
    shipId,
    details: { credentialId: valid.id },
  });
}
