import type { AccountId, FleetId, IdGenerator } from '@aeolus-fleet/common';

import { findOperatorShip, takeOverOperatorLease, type LeaseTx, type ShipTx } from '../registry/public.js';
import type { ShipCaller } from '../shared/caller.js';
import type { DomainError } from '../shared/errors.js';
import { shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import { CONSOLE_SESSION_IDLE_LIMIT_MS, consoleLocation, consoleSessionExpiry } from './console-session.js';
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
 * The session records the device it signed in from, also argo's location,
 * and the account that signed in as argo, if one did (decision 0054).
 */
export async function startConsoleSession(
  deps: { tx: StartConsoleSessionTx; ids: IdGenerator; hasher: SecretHasher; random: RandomTokens },
  input: { fleetId: FleetId; device: string; accountId: AccountId | null; at: Date },
): Promise<Result<SignedIn, DomainError<'FLEET_NOT_FOUND' | 'NOT_THE_OPERATOR_SHIP'>>> {
  const { tx, ids } = deps;
  const { fleetId, device, accountId, at } = input;
  const found = await findOperatorShip(tx, fleetId);
  if (!found.isOk) {
    return found;
  }
  const argo = found.value;

  // Only argo's sessions: viewer sessions run beside the operator's (decision 0022).
  await tx.consoleSessions.endAll({ fleetId: argo.fleetId, shipId: argo.id }, { at, reason: 'takenOver' });
  const takenOver = await takeOverOperatorLease({ tx, ids }, {
    fleetId: argo.fleetId,
    shipId: argo.id,
    kind: argo.kind,
    location: consoleLocation(device),
    actor: accountId === null ? shipActor(argo.id) : { kind: 'ship', shipId: argo.id, signedInAccountId: accountId },
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
    idleLimitMs: CONSOLE_SESSION_IDLE_LIMIT_MS,
    endsBy: null,
    device,
    accountId,
    tokenHash: deps.hasher.hash(token),
    createdAt: at,
    lastUsedAt: at,
    expiresAt,
    endedAt: null,
    endReason: null,
  });

  const caller: ShipCaller = { shipId: argo.id, fleetId: argo.fleetId, kind: argo.kind, scopes: argo.scopes, consoleSessionId, ...(accountId === null ? {} : { signedInAccountId: accountId }) };
  return ok({ token, consoleSessionId, expiresAt, caller });
}
