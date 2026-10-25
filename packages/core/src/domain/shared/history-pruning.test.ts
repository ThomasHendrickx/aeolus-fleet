import { idSchema, QUESTION_CONTENT_TYPE, type DeliveryState } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { isFinalDelivery, isFinished, pruningCutoff, type CandidateDelivery, type PruneCandidate } from './history-pruning.js';

function aCandidate(overrides: Partial<PruneCandidate> = {}): PruneCandidate {
  return {
    id: idSchema('message').parse('msg_01m5s5qvs7bkhv0rpjcm2rpc49'),
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    contentType: 'text/plain',
    isAnswered: false,
    meeting: 'none',
    isNamedBySchedule: false,
    isLocked: false,
    deliveries: [{ state: 'handled', claimingLease: 'ended' }],
    ...overrides,
  };
}

function aDelivery(state: DeliveryState, claimingLease: CandidateDelivery['claimingLease'] = 'ended'): CandidateDelivery {
  return { state, claimingLease };
}

describe('a final delivery (R2)', () => {
  it.each<DeliveryState>(['handled', 'dismissed', 'abandoned'])('is %s', (state) => {
    expect(isFinalDelivery(aDelivery(state))).toBe(true);
  });

  it.each<DeliveryState>(['pending', 'received', 'handed', 'undeliverable', 'notHandled'])('is never %s', (state) => {
    expect(isFinalDelivery(aDelivery(state))).toBe(false);
  });

  it.each<CandidateDelivery['claimingLease']>(['ended', 'open', 'none'])('is acknowledged when its claiming lease is %s: no re-read can come', (claimingLease) => {
    expect(isFinalDelivery(aDelivery('acknowledged', claimingLease))).toBe(true);
  });

  it('is not acknowledged on an open pushed lease, whose crew may still re-read it (L2)', () => {
    expect(isFinalDelivery(aDelivery('acknowledged', 'openPushed'))).toBe(false);
  });
});

describe('a finished message (R2)', () => {
  it('has every delivery final', () => {
    expect(isFinished(aCandidate({ deliveries: [aDelivery('handled'), aDelivery('acknowledged')] }))).toBe(true);
  });

  it('is not finished while one delivery is still on its way', () => {
    expect(isFinished(aCandidate({ deliveries: [aDelivery('handled'), aDelivery('pending')] }))).toBe(false);
  });

  it('is not an open question', () => {
    expect(isFinished(aCandidate({ contentType: QUESTION_CONTENT_TYPE }))).toBe(false);
  });

  it('is an answered question', () => {
    expect(isFinished(aCandidate({ contentType: QUESTION_CONTENT_TYPE, isAnswered: true }))).toBe(true);
  });

  it('is not a contribution to a meeting not ended', () => {
    expect(isFinished(aCandidate({ meeting: 'open' }))).toBe(false);
  });

  it('is a contribution to a meeting that ended', () => {
    expect(isFinished(aCandidate({ meeting: 'ended' }))).toBe(true);
  });

  it('is not named by a schedule, which is kept (decision 0066)', () => {
    expect(isFinished(aCandidate({ isNamedBySchedule: true }))).toBe(false);
  });

  it('waits for the next pass while another transaction holds its rows', () => {
    expect(isFinished(aCandidate({ isLocked: true }))).toBe(false);
  });
});

describe('the cutoff (R7)', () => {
  it('is now minus the retention', () => {
    const cutoff = pruningCutoff({ now: new Date('2026-10-25T12:30:00.000Z'), retentionDays: 30, newestSnapshotHour: new Date('2026-10-25T12:00:00.000Z') });

    expect(cutoff.toISOString()).toBe('2026-09-25T12:30:00.000Z');
  });

  it('is never later than the hour of the newest stuck snapshot', () => {
    const cutoff = pruningCutoff({ now: new Date('2026-10-25T12:30:00.000Z'), retentionDays: 1, newestSnapshotHour: new Date('2026-10-23T09:00:00.000Z') });

    expect(cutoff.toISOString()).toBe('2026-10-23T09:00:00.000Z');
  });
});
