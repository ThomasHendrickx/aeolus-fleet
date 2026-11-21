/** Approved #1991 scenarios: retirement replaces one ownership edge, never a subtree. */
import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { agentCaller, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { aQuestion } from '../../../test/support/formatted-message-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';

let core: ReturnType<typeof createInMemoryCore>;
let registry: ReturnType<typeof registryUseCases>;
let argo: ReturnType<typeof operatorCaller>;

beforeEach(async () => {
  core = createInMemoryCore();
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
});

async function aShip(name: string, kind: 'agent' | 'app' | 'person' = 'agent') {
  return unwrap(await registry.commissionShip(argo, { name, kind, type: kind, idempotencyKey: newKey() })).shipId;
}

function ownerOf(shipId: ShipId) {
  return core.state.ships.find((ship) => ship.id === shipId)?.owner;
}

describe.each(['agent', 'app'] as const)('retirement inheritance for an %s owner', (kind) => {
  it.each(['person', 'agent', 'app', 'argo'] as const)('transfers only active direct children to its immediate %s parent with OwnerChanged', async (parentKind) => {
    // Given a parent, retiring owner, two children and a grandchild.
    const parent = parentKind === 'argo' ? argo.shipId : await aShip('parent', parentKind);
    const owner = await aShip('owner', kind);
    const first = await aShip('first');
    const second = await aShip('second');
    const grandchild = await aShip('grandchild');
    for (const [shipId, ownerShipId] of [[owner, parent], [first, owner], [second, owner], [grandchild, first]] as const) {
      unwrap(await registry.setOwner(argo, { shipId, ownerShipId }));
    }
    const before = core.state.events.length;

    // When the middle owner retires.
    unwrap(await registry.retireShip(argo, { shipId: owner }));

    // Then each active direct child inherits exactly one edge; the grandchild stays put.
    expect([ownerOf(first), ownerOf(second), ownerOf(grandchild), ownerOf(owner)]).toEqual([parent, parent, first, parent]);
    expect(core.state.events.slice(before).filter((event) => event.type === 'OwnerChanged')).toEqual([
      expect.objectContaining({ shipId: first, actor: { kind: 'ship', shipId: argo.shipId }, occurredAt: core.clock.now(), details: { fromShipId: owner, toShipId: parent, why: 'ownerRetired' } }),
      expect.objectContaining({ shipId: second, actor: { kind: 'ship', shipId: argo.shipId }, occurredAt: core.clock.now(), details: { fromShipId: owner, toShipId: parent, why: 'ownerRetired' } }),
    ]);
  });

  it('leaves retired children with their recorded owner and writes no transfer when no active children remain', async () => {
    // Given an owner whose only child has retired.
    const parent = await aShip('parent', 'person');
    const owner = await aShip('owner', kind);
    const child = await aShip('child');
    unwrap(await registry.setOwner(argo, { shipId: owner, ownerShipId: parent }));
    unwrap(await registry.setOwner(argo, { shipId: child, ownerShipId: owner }));
    unwrap(await registry.retireShip(argo, { shipId: child }));
    const before = core.state.events.length;

    // When the owner retires with no active children.
    unwrap(await registry.retireShip(argo, { shipId: owner }));

    // Then retirement preserves the child's historical ownership without an owner event.
    expect(ownerOf(child)).toBe(owner);
    expect(core.state.events.slice(before).filter((event) => event.type === 'OwnerChanged')).toEqual([]);
  });
});

it('preserves person-to-argo fallback without transferring the person self-root or grandchildren', async () => {
  // Given a self-owned person with a child and grandchild.
  const person = await aShip('person', 'person');
  const child = await aShip('child');
  const grandchild = await aShip('grandchild');
  unwrap(await registry.setOwner(argo, { shipId: child, ownerShipId: person }));
  unwrap(await registry.setOwner(argo, { shipId: grandchild, ownerShipId: child }));
  const before = core.state.events.length;

  // When the person retires.
  unwrap(await registry.retireShip(argo, { shipId: person }));

  // Then only the active direct child falls to argo.
  expect([ownerOf(person), ownerOf(child), ownerOf(grandchild)]).toEqual([person, argo.shipId, child]);
  expect(core.state.events.slice(before).filter((event) => event.type === 'OwnerChanged')).toEqual([
    expect.objectContaining({ shipId: child, details: { fromShipId: person, toShipId: argo.shipId, why: 'ownerRetired' } }),
  ]);
});

it('keeps stored questions addressed to the retired immediate owner after the child inherits its parent', async () => {
  // Given a child has asked its immediate agent owner a question.
  const parent = await aShip('parent', 'person');
  const owner = await aShip('owner');
  const child = await aShip('child');
  unwrap(await registry.setOwner(argo, { shipId: owner, ownerShipId: parent }));
  unwrap(await registry.setOwner(argo, { shipId: child, ownerShipId: owner }));
  const messaging = messagingUseCases(core);
  const { messageId } = unwrap(await messaging.sendFormattedMessage(agentCaller({ fleetId: argo.fleetId, shipId: child }), {
    selector: { kind: 'ship', shipId: owner }, message: { kind: 'question', question: aQuestion() }, model: SESSION_MODEL, idempotencyKey: newKey(),
  }));
  const message = structuredClone(core.state.messages.find((stored) => stored.id === messageId));

  // When that owner retires and the child inherits its parent.
  unwrap(await registry.retireShip(argo, { shipId: owner }));

  // Then the stored message is unchanged and its delivery is abandoned at its original destination.
  expect(ownerOf(child)).toBe(parent);
  expect(core.state.messages.find((stored) => stored.id === messageId)).toEqual(message);
  expect(core.state.deliveries.filter((stored) => stored.messageId === messageId)).toMatchObject([{ recipient: { kind: 'ship', shipId: owner }, state: 'abandoned' }]);
});
