import { CLEAR_REQUESTS_PER_TRIERARCH_MAX, type ClearOutcome, type FleetId, type ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Ship } from './ship.js';

/**
 * A declared request that a trierarch clear a worktree it kept (decision
 * 0032). The worktree is named by the ship it belonged to and its
 * repository, never a path: paths stay on the machine. It stays pending
 * until its trierarch confirms, and it is never withdrawn.
 */
export interface ClearRequest {
  fleetId: FleetId;
  trierarchShipId: ShipId;
  /** The ship the kept worktree belonged to. */
  shipId: ShipId;
  repository: string;
  requestedBy: ShipId;
  requestedAt: Date;
}

/** The type of the ship a trierarch crews (docs/trierarch.md). */
export const TRIERARCH_SHIP_TYPE = 'trierarch';

export type RequestWorktreeClearRefusal = DomainError<'NOT_A_TRIERARCH' | 'SHIP_ALREADY_RETIRED' | 'CLEAR_REQUEST_LIMIT_REACHED'>;

export type ConfirmWorktreeClearedRefusal = DomainError<'CLEAR_REQUEST_NOT_FOUND'>;

function event(trierarch: Ship, change: Pick<NewEvent, 'type' | 'details'> & { at: Date; actor: Actor }): NewEvent {
  const { at, actor, ...what } = change;
  return { fleetId: trierarch.fleetId, occurredAt: at, actor, shipId: trierarch.id, ...what };
}

/**
 * A ship asks a trierarch to clear the worktree it kept for a ship in a
 * repository: the request, and WorktreeClearRequested on the trierarch's
 * ship. Only a trierarch that is not retired; at most
 * CLEAR_REQUESTS_PER_TRIERARCH_MAX pending at once. A request it holds
 * already changes nothing: no request and no event.
 */
export function requestWorktreeClear(
  { trierarch, current, pending }: { trierarch: Ship; current: ClearRequest | undefined; pending: number },
  input: { shipId: ShipId; repository: string; requestedBy: ShipId; at: Date; actor: Actor },
): Result<{ request: ClearRequest | null; events: NewEvent[] }, RequestWorktreeClearRefusal> {
  if (trierarch.type !== TRIERARCH_SHIP_TYPE) {
    return refuse('NOT_A_TRIERARCH', `${trierarch.name} is no trierarch: only a trierarch clears a worktree it kept`);
  }
  if (trierarch.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `${trierarch.name} is retired: a retired trierarch clears nothing`);
  }
  if (current) {
    return ok({ request: null, events: [] });
  }
  if (pending >= CLEAR_REQUESTS_PER_TRIERARCH_MAX) {
    return refuse(
      'CLEAR_REQUEST_LIMIT_REACHED',
      `${trierarch.name} holds ${String(CLEAR_REQUESTS_PER_TRIERARCH_MAX)} clear requests already, the most a trierarch may hold (decision 0032): ask again once it confirms some`,
    );
  }
  const { shipId, repository, requestedBy, at, actor } = input;
  return ok({
    request: { fleetId: trierarch.fleetId, trierarchShipId: trierarch.id, shipId, repository, requestedBy, requestedAt: at },
    events: [event(trierarch, { type: 'WorktreeClearRequested', details: { worktreeShipId: shipId, repository }, at, actor })],
  });
}

/**
 * The trierarch confirms a clear request it holds, saying how it came out:
 * the request goes, with WorktreeCleared and the outcome.
 */
export function confirmWorktreeCleared(
  { trierarch, worktreeShipName, current }: { trierarch: Ship; worktreeShipName: string; current: ClearRequest | undefined },
  input: { repository: string; outcome: ClearOutcome; at: Date; actor: Actor },
): Result<{ events: NewEvent[] }, ConfirmWorktreeClearedRefusal> {
  const { repository, outcome, at, actor } = input;
  if (!current) {
    return refuse('CLEAR_REQUEST_NOT_FOUND', `${trierarch.name} holds no clear request for the ${repository} worktree of ${worktreeShipName}`);
  }
  return ok({ events: [event(trierarch, { type: 'WorktreeCleared', details: { worktreeShipId: current.shipId, repository, outcome }, at, actor })] });
}

/** A retired trierarch clears nothing: its pending requests go, one WorktreeClearRemoved each. */
export function removeClearRequestsOf({ trierarch, requests }: { trierarch: Ship; requests: readonly ClearRequest[] }, change: { at: Date; actor: Actor }): NewEvent[] {
  return requests.map(({ shipId, repository }) =>
    event(trierarch, { type: 'WorktreeClearRemoved', details: { worktreeShipId: shipId, repository }, ...change }),
  );
}
