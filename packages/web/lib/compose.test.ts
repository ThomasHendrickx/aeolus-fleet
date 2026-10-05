import { createIdGenerator, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { composeTargets, sendInputOf } from './compose';

const newId = createIdGenerator();

function aShip(ship: Partial<ListedShip>): ListedShip {
  return {
    id: newId('ship'),
    name: 'scout',
    type: 'reviewer',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: null,
    location: null,
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null, harness: null, model: null, awaitingCrewSince: null,
    ...ship,
  };
}

describe('composeTargets', () => {
  it('offers the active agent ships, never argo and never a retired one, and their types once each, sorted', () => {
    const reviewer = aShip({ name: 'reviewer-01', type: 'reviewer' });
    const waiting = aShip({ name: 'tester-01', type: 'tester', status: 'awaitingCrew' });
    const second = aShip({ name: 'reviewer-02', type: 'reviewer' });
    const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });
    const retired = aShip({ name: 'old', type: 'deployer', status: 'retired' });

    expect(composeTargets([reviewer, waiting, second, argo, retired])).toEqual({
      ships: [reviewer, waiting, second],
      types: ['reviewer', 'tester'],
    });
  });
});

describe('sendInputOf', () => {
  it('sends plain text to the chosen selector under the given key', () => {
    const shipId = newId('ship');

    expect(sendInputOf({ selector: { kind: 'ship', shipId }, payload: 'Pause reviews' }, 'compose-1')).toEqual({
      selector: { kind: 'ship', shipId },
      payload: 'Pause reviews',
      contentType: 'text/plain',
      idempotencyKey: 'compose-1',
    });
  });

  it('names the message a reply answers', () => {
    const shipId = newId('ship');
    const inReplyTo = newId('message');

    expect(sendInputOf({ selector: { kind: 'ship', shipId }, payload: 'go', inReplyTo }, 'reply-1')).toMatchObject({ inReplyTo });
  });
});
