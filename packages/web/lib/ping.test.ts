import { describe, expect, it } from 'vitest';

import { answerTime, canPing, pingLine } from './ping';

const NOW = new Date('2026-10-02T09:10:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe('canPing', () => {
  it('offers Ping on a crewed agent ship', () => {
    expect(canPing({ kind: 'agent', status: 'crewed' })).toBe(true);
  });

  it.each([
    ['a ship awaiting crew', { kind: 'agent', status: 'awaitingCrew' }],
    ['a retired ship', { kind: 'agent', status: 'retired' }],
    ['argo', { kind: 'operator', status: 'crewed' }],
  ] as const)('does not offer Ping on %s', (_label, ship) => {
    expect(canPing(ship)).toBe(false);
  });
});

describe('answerTime', () => {
  it('counts seconds under a minute', () => {
    expect(answerTime(new Date('2026-10-02T09:00:00.000Z'), new Date('2026-10-02T09:00:04.000Z'))).toBe('4 s');
  });

  it('counts minutes from a minute on', () => {
    expect(answerTime(new Date('2026-10-02T09:00:00.000Z'), new Date('2026-10-02T09:11:30.000Z'))).toBe('11 min');
  });
});

describe('pingLine', () => {
  it('says how long ago a ping was sent that waits for an answer', () => {
    expect(pingLine({ state: 'waiting', sentAt: minutesAgo(3), answeredAt: null }, NOW)).toBe(
      'Pinged 3 min ago, no answer yet',
    );
  });

  it('says just now for a ping sent under a minute ago', () => {
    expect(pingLine({ state: 'waiting', sentAt: NOW.toISOString(), answeredAt: null }, NOW)).toBe(
      'Pinged just now, no answer yet',
    );
  });

  it('says how fast the session answered with pong', () => {
    expect(
      pingLine({ state: 'answered', sentAt: '2026-10-02T09:00:00.000Z', answeredAt: '2026-10-02T09:00:04.000Z' }, NOW),
    ).toBe('Answered ping in 4 s');
  });

  it('says a ping acknowledged without pong was received, not answered', () => {
    expect(pingLine({ state: 'received', sentAt: minutesAgo(3), answeredAt: null }, NOW)).toBe(
      'Received, not answered with pong',
    );
  });
});
