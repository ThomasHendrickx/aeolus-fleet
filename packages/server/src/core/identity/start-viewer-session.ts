import type { FleetId, IdGenerator } from '@aeolus-fleet/common';

import { findViewerShip, type ShipTx } from '../registry/public.js';
import type { Caller } from '../shared/caller.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import { viewerSessionTimes } from './console-session.js';
import type { ConsoleSessionRepository } from './ports.js';
import type { SignedIn } from './sign-in.js';

export interface StartViewerSessionTx extends ShipTx {
  consoleSessions: ConsoleSessionRepository;
  events: EventLog;
}

/**
 * Starts a viewer session on the fleet's viewer ship (decision 0022), in the
 * caller's unit of work: it holds no lease and ends no other session, so many
 * people view at once, and the operator's session is untouched. Valid 2 hours
 * after its last use, never past 24 hours after it started. Writes
 * ViewerSessionStarted, by the viewer ship, with the device.
 */
export async function startViewerSession(
  deps: { tx: StartViewerSessionTx; ids: IdGenerator; hasher: SecretHasher; random: RandomTokens },
  input: { fleetId: FleetId; device: string; at: Date },
): Promise<Result<SignedIn, DomainError<'FLEET_HAS_NO_VIEWER'>>> {
  const { tx, ids } = deps;
  const { fleetId, device, at } = input;
  const found = await findViewerShip(tx, fleetId);
  if (!found.isOk) {
    return found;
  }
  const viewer = found.value;

  const token = deps.random.next();
  const consoleSessionId = ids('consoleSession');
  const { idleLimitMs, endsBy, expiresAt } = viewerSessionTimes(at);
  await tx.consoleSessions.create({
    id: consoleSessionId,
    fleetId,
    shipId: viewer.id,
    leaseId: null,
    idleLimitMs,
    endsBy,
    device,
    tokenHash: deps.hasher.hash(token),
    createdAt: at,
    lastUsedAt: at,
    expiresAt,
    endedAt: null,
    endReason: null,
  });
  await recordEvent({ events: tx.events, ids }, { fleetId, type: 'ViewerSessionStarted', occurredAt: at, actor: shipActor(viewer.id), shipId: viewer.id, details: { device } });

  const caller: Caller = { shipId: viewer.id, fleetId, kind: viewer.kind, scopes: viewer.scopes, consoleSessionId };
  return ok({ token, consoleSessionId, expiresAt, caller });
}
