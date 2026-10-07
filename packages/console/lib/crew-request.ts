import type { CrewStatus, ListedShip, Party, TimelineEntry } from '@aeolus-fleet/common';

/**
 * Where a ship's crew request stands, as its card on the ship page shows it
 * (docs/design/README.md, CrewRequest; decision 0029): none; needs crew, the
 * operator's to-do, with the trierarch plugin's reason when it gave one;
 * crewed by hand while still unassigned; or assigned to a trierarch, with the
 * status it wrote, its restart attempt and when its session started. An assigned request with no status yet is crewing: the
 * crew writes its first status itself.
 */
export type CrewRequestStage =
  | { kind: 'none' }
  | { kind: 'needsCrew'; requestedAt: string; reason: string | null }
  | { kind: 'crewedByHand'; requestedAt: string; crewedBy: Party; since: string | null }
  | { kind: 'assigned'; requestedAt: string; trierarch: Party; status: CrewStatus; attempt: number; startedAt: string | null };

/** The stage of a ship's crew request, from the fleet list or the ship page; when it was crewed, where the page knows it. */
export function crewRequestStage(ship: Pick<ListedShip, 'crewRequest'> & { crewedSince?: string | null }): CrewRequestStage {
  const request = ship.crewRequest;
  if (request === null) {
    return { kind: 'none' };
  }
  if (request.assignedTo !== null) {
    return {
      kind: 'assigned',
      requestedAt: request.requestedAt,
      trierarch: request.assignedTo,
      status: request.status ?? 'crewing',
      attempt: request.attempt,
      startedAt: request.startedAt,
    };
  }
  if (request.crewedBy !== null) {
    return { kind: 'crewedByHand', requestedAt: request.requestedAt, crewedBy: request.crewedBy, since: ship.crewedSince ?? null };
  }
  return { kind: 'needsCrew', requestedAt: request.requestedAt, reason: request.reason };
}

/**
 * The card's one action, with two labels (#245, decision 4): Remove request
 * while no crew is on it, Release once a crew or a trierarch is; none while it
 * releases, nor without a request.
 */
export function crewRequestAction(stage: CrewRequestStage): 'remove' | 'release' | undefined {
  switch (stage.kind) {
    case 'none':
      return undefined;
    case 'needsCrew':
      return 'remove';
    case 'crewedByHand':
      return 'release';
    case 'assigned':
      return stage.status === 'releasing' ? undefined : 'release';
  }
}

/**
 * The restart attempt in words (canvas TpMachine "Running here",
 * CrBlockRestarting, CrBlockCrashed; #332): "attempt 2" while restarting,
 * "3 restarts" once crashed, "1 restart" while running after one. None on a
 * first start, nor while crewing or releasing. The trierarch's restart budget
 * is its own, so no "of 3".
 */
export function restartWords({ status, attempt }: { status: CrewStatus; attempt: number }): string | undefined {
  const restarts = `${String(attempt)} ${attempt === 1 ? 'restart' : 'restarts'}`;
  switch (status) {
    case 'restarting':
      return `attempt ${String(attempt)}`;
    case 'crashed':
      return restarts;
    case 'running':
      return attempt === 0 ? undefined : restarts;
    case 'crewing':
    case 'releasing':
      return undefined;
  }
}

/** Restart is offered on a crashed request only (#245, decision 2). */
export function isRestartable(stage: CrewRequestStage): boolean {
  return stage.kind === 'assigned' && stage.status === 'crashed';
}

/**
 * The fleet calls a release from the card makes, in order. Removing an
 * assigned request is the release: its trierarch stops the session and
 * confirms. A crew aboard without a trierarch stays aboard when its request
 * goes, so the lease is released after it; removing first keeps the ship from
 * being assigned in between.
 */
export function releaseSteps(stage: CrewRequestStage): readonly ('removeCrewRequest' | 'release')[] {
  return stage.kind === 'crewedByHand' ? ['removeCrewRequest', 'release'] : ['removeCrewRequest'];
}

/**
 * Who asked for the ship's crew request: the actor of its latest
 * CrewRequested event, from the timeline, newest first. No stored field
 * holds it. Null when the timeline holds none or the system wrote it.
 */
export function requestedBy(timeline: readonly TimelineEntry[]): Party | null {
  return timeline.find((entry) => entry.type === 'CrewRequested')?.actor ?? null;
}

/** When the crew's status last changed, from the timeline, newest first: when it crashed or was asked to release. */
export function statusChangedAt(timeline: readonly TimelineEntry[]): string | undefined {
  return timeline.find((entry) => entry.type === 'CrewStatusChanged')?.occurredAt;
}
