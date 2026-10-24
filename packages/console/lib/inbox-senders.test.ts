import { createIdGenerator, type InboxMessage, type ListedShip, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { readInboxSenders, type ListShips } from './inbox-senders';

const newId = createIdGenerator();
const AT = '2026-10-24T09:00:00.000Z';

function aShip(name: string, overrides: Partial<ListedShip> = {}): ListedShip {
  return {
    id: newId('ship'), name, type: 'orchestrator', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
    scopes: ['messages:send', 'messages:receive'], labels: [], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, retiredAt: null, ownerShipId: null,
    ...overrides,
  };
}

function aMessage(sender: { id: ShipId; name: string }): InboxMessage {
  return {
    deliveryId: newId('delivery'),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    replies: [],
    message: { id: newId('message'), sender: { id: sender.id, name: sender.name }, inReplyTo: null, sentAt: AT, contentType: 'text/plain', model: 'claude-opus-5-5', payload: 'Slice 7 done' },
  };
}

/** A fleet.list over these ships, as core selects them, keeping each read it was asked. */
function aFleet(ships: readonly ListedShip[]): { list: ListShips; asked: Parameters<ListShips>[0][] } {
  const asked: Parameters<ListShips>[0][] = [];
  const list: ListShips = (input) => {
    asked.push(input);
    const selected = ships.filter((ship) => (input.shipIds === undefined || input.shipIds.includes(ship.id)) && (input.name === undefined || ship.name === input.name));
    return Promise.resolve({ kind: 'answered', data: { items: selected.slice(0, input.limit) } });
  };
  return { list, asked };
}

describe('readInboxSenders', () => {
  it('reads the senders by id and by name, never every ship', async () => {
    const orchestrator = aShip('orchestrator-1');
    const { list, asked } = aFleet([orchestrator, aShip('vault'), aShip('dock')]);

    const senders = await readInboxSenders([aMessage(orchestrator), aMessage(orchestrator)], list);

    expect([senders, asked]).toEqual([
      { kind: 'answered', data: [orchestrator] },
      [
        { shipIds: [orchestrator.id], status: ['awaitingCrew', 'crewed', 'retired'], limit: 1 },
        { name: 'orchestrator-1', status: ['awaitingCrew', 'crewed', 'retired'], limit: 2 },
      ],
    ]);
  });

  it('reads a retired ship that had the sender name, so the inbox tells the two apart', async () => {
    const orchestrator = aShip('orchestrator-1');
    const retired = aShip('orchestrator-1', { status: 'retired' });
    const { list } = aFleet([orchestrator, retired]);

    const senders = await readInboxSenders([aMessage(orchestrator)], list);

    expect(senders).toEqual({ kind: 'answered', data: [orchestrator, retired] });
  });

  it('leaves out a ship outside read reach', async () => {
    const vault = { id: newId('ship'), name: 'vault', type: 'keeper', status: 'crewed', isInReadReach: false } as const;
    const list: ListShips = () => Promise.resolve({ kind: 'answered', data: { items: [vault] } });

    expect(await readInboxSenders([aMessage(vault)], list)).toEqual({ kind: 'answered', data: [] });
  });

  it('answers the refusal of a read', async () => {
    const list: ListShips = () => Promise.resolve({ kind: 'refused', message: 'The fleet does not answer' });

    expect(await readInboxSenders([aMessage(aShip('dock'))], list)).toEqual({ kind: 'refused', message: 'The fleet does not answer' });
  });

  it('reads nothing for an empty inbox', async () => {
    const { list, asked } = aFleet([aShip('dock')]);

    expect([await readInboxSenders([], list), asked]).toEqual([{ kind: 'answered', data: [] }, []]);
  });
});
