import { idSchema, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaDeliveryRepository } from '../src/adapters/prisma/messaging.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// The exchange read on a real Postgres (docs/design/exchange-read, E1 to
// E3): every message one of two ships sent that reached the other, by name,
// by type once claimed, or by label, both ways, newest first; meetings and
// pings left out, and only within the caller's fleet.

const MODEL = 'claude-opus-5-5';

let core: PostgresCore;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
});

afterEach(async () => {
  await core.close();
});

async function crewed(ship: { name: string; kind: 'person' | 'agent'; type: string }): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

async function send(from: ShipCaller, to: Selector, payload: string): Promise<MessageId> {
  core.clock.advance(1_000);
  const model = from.kind === 'agent' ? { model: MODEL } : {};
  return unwrap(await core.useCases.sendMessage(from, { selector: to, payload, contentType: 'text/plain', idempotencyKey: newKey(), ...model })).messageId;
}

async function labelValue(shipIds: readonly ShipId[]): Promise<Selector> {
  const { shipId: pluginId } = unwrap(
    await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['labels:define', 'labels:assign'] }),
  );
  const plugin: ShipCaller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['labels:define', 'labels:assign'] };
  const { values } = unwrap(await core.useCases.defineLabel(plugin, { key: 'team', values: ['bridge'] }));
  const valueId = values[0]?.id;
  if (valueId === undefined) {
    throw new Error('defineLabel answered no value');
  }
  for (const shipId of shipIds) {
    unwrap(await core.useCases.assignLabel(plugin, { shipId, valueId }));
  }
  return { kind: 'label', valueIds: [valueId] };
}

describe('the exchange read on Postgres', () => {
  it('reads by name, by type once claimed and by label, both ways, newest first, and leaves meetings and pings out', async () => {
    // Given the lookout wrote to thomas by name, to thomas's type which thomas's crew claimed, and to a label thomas holds;
    // thomas answered by name; argo pinged both; and the lookout opened a meeting with thomas.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    const byName = await send(lookout, { kind: 'ship', shipId: thomas.shipId }, 'Merge PR #1497?');
    const byType = await send(lookout, { kind: 'type', type: 'person' }, 'Who is on call?');
    unwrap(await core.useCases.pushReceiveDeliveries(thomas, {}));
    const byLabel = await send(lookout, await labelValue([thomas.shipId]), 'Standup in five');
    const answer = await send(thomas, { kind: 'ship', shipId: lookout.shipId }, 'Yes, merge it');
    unwrap(await core.useCases.pingShip(argo, { shipId: thomas.shipId }));
    unwrap(await core.useCases.pingShip(argo, { shipId: lookout.shipId }));
    unwrap(await core.useCases.openMeeting(lookout, { ships: [{ shipId: thomas.shipId }], idempotencyKey: newKey(), model: MODEL }));

    // When thomas reads its exchange with the lookout, and the lookout its exchange with argo.
    const withLookout = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId }));
    const withArgo = unwrap(await core.useCases.readExchange(lookout, { otherShipId: argo.shipId }));

    // Then the four messages show, newest first, and nothing from the meeting or the pings.
    expect(withLookout.items.map(({ messageId, senderShipId }) => ({ messageId, senderShipId }))).toEqual([
      { messageId: answer, senderShipId: thomas.shipId },
      { messageId: byLabel, senderShipId: lookout.shipId },
      { messageId: byType, senderShipId: lookout.shipId },
      { messageId: byName, senderShipId: lookout.shipId },
    ]);
    expect(withLookout.items[0]).toMatchObject({ payload: 'Yes, merge it', deliveryState: 'pending' });
    expect(withArgo.items).toEqual([]);
  });

  it('pages older, newer and around one message along the exchange', async () => {
    // Given the lookout and thomas wrote to each other in turn, 30 messages.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    const sent: MessageId[] = [];
    for (let n = 1; n <= 30; n += 1) {
      sent.push(n % 2 === 0 ? await send(thomas, { kind: 'ship', shipId: lookout.shipId }, `Note ${String(n)}`) : await send(lookout, { kind: 'ship', shipId: thomas.shipId }, `Note ${String(n)}`));
    }

    // When thomas reads the newest five, the five older, then the five newer than those, and the page around the 15th.
    const newest = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId, limit: 5 }));
    const older = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId, limit: 5, before: newest.olderCursor ?? undefined }));
    const newer = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId, limit: 5, after: older.newerCursor ?? undefined }));
    const around = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId, around: sent[14] }));

    // Then each page holds its messages newest first.
    const notes = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, index) => `Note ${String(from - index)}`);
    expect(newest.items.map((item) => item.payload)).toEqual(notes(30, 26));
    expect(older.items.map((item) => item.payload)).toEqual(notes(25, 21));
    expect(newer.items.map((item) => item.payload)).toEqual(notes(30, 26));
    expect(newer.newerCursor).toBeNull();
    expect(around.items.map((item) => item.payload)).toEqual(notes(25, 6));
  });

  it("reads only within the caller's fleet", async () => {
    // Given the lookout wrote to thomas.
    const thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
    const lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
    await send(lookout, { kind: 'ship', shipId: thomas.shipId }, 'Merge PR #1497?');
    const elsewhere = idSchema('fleet').parse(`flt_${'0'.repeat(26)}`);

    // When the same exchange is read in another fleet.
    const rows = await createPrismaDeliveryRepository(core.prisma).findExchangePage({ fleetId: elsewhere, shipId: thomas.shipId, otherShipId: lookout.shipId, toward: 'older', limit: 20 });

    // Then it holds nothing.
    expect(rows).toEqual([]);
  });
});
