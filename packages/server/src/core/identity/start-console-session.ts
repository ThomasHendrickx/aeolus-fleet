import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import { findOperatorShip, takeOverOperatorLease, type LeaseTx, type ShipTx } from '../registry/public.js';
import type { Caller } from '../shared/caller.js';
import type { DomainError } from '../shared/errors.js';
import { shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import { consoleLocation, consoleSessionExpiry } from './console-session.js';
import type { ConsoleSessionRepository } from './ports.js';
import type { SignedIn } from './sign-in.js';

export interface StartConsoleSessionTx extends LeaseTx, ShipTx {
  consoleSessions: ConsoleSessionRepository;
}

/**
 * Starts the operator's console session crewing the fleet's argo (ADR 0012),
 * in the caller's unit of work, however the operator proved who they are: a
 * password or a sign-in ticket. It ends the previous console session and
 * takes argo's lease over, so what argo held in flight returns to pending.
 * The session records the device it signed in from, also argo's location.
 */
export async function startConsoleSession(
  deps: { tx: StartConsoleSessionTx; ids: IdGenerator; hasher: SecretHasher; random: RandomTokens },
  input: { fleetId: FleetId; device: string; at: Date },
): Promise<Result<SignedIn, DomainError<'FLEET_NOT_FOUND' | 'NOT_THE_OPERATOR_SHIP'>>> {
  const { tx, ids } = deps;
  const { fleetId, device, at } = input;
  const found = await findOperatorShip(tx, fleetId);
  if (!found.isOk) {
    return found;
  }
  const argo = found.value;

  await tx.consoleSessions.endAll(argo.fleetId, { at, reason: 'takenOver' });
  const takenOver = await takeOverOperatorLease({ tx, ids }, {
    fleetId: argo.fleetId,
    shipId: argo.id,
    kind: argo.kind,
    location: consoleLocation(device),
    actor: shipActor(argo.id),
    at,
  });
  if (!takenOver.isOk) {
    return takenOver;
  }

  const token = deps.random.next();
  const consoleSessionId = ids('consoleSession');
  const expiresAt = consoleSessionExpiry(at);
  await tx.consoleSessions.create({
    id: consoleSessionId,
    fleetId: argo.fleetId,
    shipId: argo.id,
    leaseId: takenOver.value,
    device,
    tokenHash: deps.hasher.hash(token),
    createdAt: at,
    lastUsedAt: at,
    expiresAt,
    endedAt: null,
    endReason: null,
  });

  const caller: Caller = { shipId: argo.id, fleetId: argo.fleetId, kind: argo.kind, scopes: argo.scopes, consoleSessionId };
  return ok({ token, consoleSessionId, expiresAt, caller });
}
