import type { MessageDetail } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import {
  DIRECT_MESSAGE,
  HANDED_NOT_CONFIRMED_MESSAGE,
  LEASE_ENDED_MESSAGE,
  MAC_MINI,
  NOT_HANDLED_MESSAGE,
  NOW,
  PENDING_BUSY_MESSAGE,
  PING_WAITING_MESSAGE,
  PUSHED_HANDLED_MESSAGE,
  RECEIVED_RESTARTING_MESSAGE,
  TYPE_MESSAGE,
  minutesAgo,
} from '../../../lib/fixtures/ship-page.fixtures';
import { clockTime } from '../../../lib/relative-time';
import { deliveryStatus, messageWay } from './message-way';

function linesOf(message: MessageDetail, machines?: Parameters<typeof messageWay>[1]['machines']): string[] {
  return messageWay(message, { now: NOW, ...(machines === undefined ? {} : { machines }) }).lines.map((line) => line.text);
}

describe('deliveryStatus', () => {
  it('reads a pushed hand-over as handed, a plain receive as handed (pulled), and every other state as itself', () => {
    expect(deliveryStatus({ state: 'handed', isPulled: false })).toBe('handedPushed');
    expect(deliveryStatus({ state: 'handed', isPulled: true })).toBe('handed');
    expect(deliveryStatus({ state: 'acknowledged', isPulled: false })).toBe('acknowledged');
  });
});

describe('messageWay', () => {
  it('reads a pushed hand-over as handed, a pulled one as handed (pulled)', () => {
    expect(messageWay(HANDED_NOT_CONFIRMED_MESSAGE, { now: NOW }).status).toBe('handedPushed');
    expect(messageWay(TYPE_MESSAGE, { now: NOW }).status).toBe('handed');
  });

  it('says the agent has it, not confirmed, the attempt, and that argo was told at 10 min', () => {
    expect(linesOf(HANDED_NOT_CONFIRMED_MESSAGE)).toEqual(['Agent · 12 min ago · not confirmed · attempt 2 of 5', 'argo told at 10 min']);
  });

  it('says the fleet holds it while the session is busy, and argo was told at 60 min', () => {
    expect(linesOf(PENDING_BUSY_MESSAGE)).toEqual([
      'Fleet · 1 h ago',
      `Session busy since ${clockTime(new Date(minutesAgo(70)))}`,
      'argo told at 60 min',
    ]);
  });

  it('names the trierarch on its computer that received it, and its session restarting', () => {
    expect(linesOf(RECEIVED_RESTARTING_MESSAGE)).toEqual(['Trierarch on mac-mini · 3 min ago', 'Session restarting (restart 2)']);
  });

  it('says the trierarch on its computer is silent, when its machine says so', () => {
    const silentSince = minutesAgo(7);
    const machines = [{ shipId: MAC_MINI.id, isSilent: true, lastSeenAt: silentSince }];

    expect(linesOf(RECEIVED_RESTARTING_MESSAGE, machines)).toContain(`Trierarch on mac-mini silent since ${clockTime(new Date(silentSince))}`);
  });

  it('says nothing of a trierarch that answers', () => {
    const machines = [{ shipId: MAC_MINI.id, isSilent: false, lastSeenAt: minutesAgo(0) }];

    expect(linesOf(RECEIVED_RESTARTING_MESSAGE, machines).some((text) => text.includes('silent'))).toBe(false);
  });

  it('says a handled message was handled, with no holder', () => {
    expect(linesOf(PUSHED_HANDLED_MESSAGE)).toEqual(['2 min ago']);
  });

  it('says the session died twice, and when argo was told', () => {
    expect(linesOf(NOT_HANDLED_MESSAGE)).toEqual(['5 min ago', `Session died twice · argo told ${clockTime(new Date(minutesAgo(5)))}`]);
  });

  it('says handled is unknown when the lease ended after the acknowledgement', () => {
    expect(linesOf(LEASE_ENDED_MESSAGE)).toEqual(['Agent · 20 min ago', 'Handled unknown: lease ended']);
  });

  it('says a pull ship reports no handled', () => {
    expect(linesOf(DIRECT_MESSAGE)).toEqual(['Agent · 3 min ago', 'Handled: not reported (pull ship)']);
  });

  it('counts the plain receives of a pulled one, not acknowledged', () => {
    expect(linesOf(TYPE_MESSAGE)).toEqual(['Agent (pulled) · 10 min ago · not acknowledged · handed (pulled) 2 times']);
  });

  it('reads a ping as pinged and handed, with no answer yet', () => {
    expect(linesOf(PING_WAITING_MESSAGE)).toEqual(['Pinged 3 min ago · handed 1 min ago · no answer yet']);
  });

  it('reads an answered ping by how soon after the hand-over it was answered', () => {
    const [handed, stored] = PING_WAITING_MESSAGE.delivery.history;
    if (!handed || !stored) {
      throw new Error('The ping example has its steps');
    }
    const answered = { ...handed, seq: 113, type: 'DeliveryAcknowledged' as const, occurredAt: new Date(new Date(handed.occurredAt).getTime() + 4_000).toISOString() };
    const ping = { ...PING_WAITING_MESSAGE, delivery: { ...PING_WAITING_MESSAGE.delivery, state: 'acknowledged' as const, history: [answered, handed, stored] } };

    expect(linesOf(ping)).toEqual(['Answered ping in 4 s after hand-over']);
  });
});
