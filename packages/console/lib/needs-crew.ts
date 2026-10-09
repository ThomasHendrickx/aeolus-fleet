import type { CrewStatus, ListedShip } from '@aeolus-fleet/common';

import { crewRequestStage, type CrewRequestStage } from './crew-request';

/**
 * Needs crew (#245, S4; canvas CrNeedsOff, CrNeedsOn): the operator's to-do
 * of crew requests. Without the trierarch plugin, the ships asked to be kept
 * crewed that await crew, to crew by hand. With it, the requests that are not
 * running: waiting for a trierarch, crewing, restarting or crashed. A ship
 * crewed by hand, a running crew and a request being released are not on it.
 */
export function isNeedingCrew(ship: Pick<ListedShip, 'status' | 'crewRequest'>, plugin: { hasTrierarchs: boolean }): boolean {
  if (ship.status === 'retired') {
    return false;
  }
  const stage = crewRequestStage(ship);
  if (!plugin.hasTrierarchs) {
    return stage.kind === 'needsCrew' && ship.status === 'awaitingCrew';
  }
  return stage.kind === 'needsCrew' || (stage.kind === 'assigned' && stage.status !== 'running' && stage.status !== 'releasing');
}

/** The ships on Needs crew, oldest request first. */
export function needsCrew<T extends Pick<ListedShip, 'status' | 'crewRequest'>>(ships: readonly T[], plugin: { hasTrierarchs: boolean }): T[] {
  return ships
    .filter((ship) => isNeedingCrew(ship, plugin))
    .toSorted((one, other) => (one.crewRequest?.requestedAt ?? '').localeCompare(other.crewRequest?.requestedAt ?? ''));
}

/** How a ship on Needs crew stands for crewing by hand (canvas CrNeedsOff, Crew): no prompt yet, a prompt no session took, or a hand crew that ended. */
export type HandCrew = { kind: 'no-prompt' } | { kind: 'prompt-unclaimed'; issuedAt: string } | { kind: 'crew-ended'; endedAt: string | null };

export function handCrewOf(ship: Pick<ListedShip, 'startingPrompt' | 'awaitingCrewSince'>): HandCrew {
  if (ship.startingPrompt === null) {
    return { kind: 'no-prompt' };
  }
  return ship.startingPrompt.isClaimed ? { kind: 'crew-ended', endedAt: ship.awaitingCrewSince } : { kind: 'prompt-unclaimed', issuedAt: ship.startingPrompt.issuedAt };
}

/** A crew request's state as a table cell shows it (canvas CrewRequest, "In tables"): a tone and a word; none without a request. */
export type CrewRequestCell = { tone: 'waiting' | 'active' | 'ok' | 'attention'; word: string } | undefined;

const ASSIGNED_CELLS = {
  crewing: { tone: 'active', word: 'Crewing' },
  running: { tone: 'ok', word: 'Running' },
  restarting: { tone: 'waiting', word: 'Restarting' },
  crashed: { tone: 'attention', word: 'Crashed' },
  releasing: { tone: 'active', word: 'Releasing' },
} as const;

export function crewRequestCell(stage: CrewRequestStage): CrewRequestCell {
  switch (stage.kind) {
    case 'none':
      return undefined;
    case 'needsCrew':
      return { tone: 'waiting', word: 'Needs crew' };
    case 'crewedByHand':
      return { tone: 'ok', word: 'Crewed by hand' };
    case 'assigned':
      return ASSIGNED_CELLS[stage.status];
  }
}

/** A crew request's stage as one key, for the overview's Crew request filter: none, needs crew, crewed by hand, or its status. */
export type CrewRequestKey = 'none' | 'needsCrew' | 'crewedByHand' | CrewStatus;

/** The keys in the order of a request's life, the crew statuses as common lists them. */
export function crewRequestKeysOf(crewStatuses: readonly CrewStatus[]): CrewRequestKey[] {
  return ['none', 'needsCrew', 'crewedByHand', ...crewStatuses];
}

export function crewRequestKey(stage: CrewRequestStage): CrewRequestKey {
  return stage.kind === 'assigned' ? stage.status : stage.kind;
}

/** Each key in words, as the filter offers it: the table cell's word, or No request. */
export function crewRequestKeyWord(key: CrewRequestKey): string {
  if (key === 'none') {
    return 'No request';
  }
  if (key === 'needsCrew') {
    return 'Needs crew';
  }
  return key === 'crewedByHand' ? 'Crewed by hand' : ASSIGNED_CELLS[key].word;
}
