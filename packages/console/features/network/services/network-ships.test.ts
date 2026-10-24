import { createIdGenerator, type NetworkRulesDraftChanges } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { networkShipIdsOf } from './network-ships';

const newId = createIdGenerator();

const NO_CHANGES: NetworkRulesDraftChanges = {
  send: { gained: [], lost: [] },
  read: { gained: [], lost: [] },
  manage: { gained: [], lost: [] },
};

describe('networkShipIdsOf', () => {
  it('names the owners the rules name, never any owner or the same owner', () => {
    const alice = newId('ship');
    const team = newId('labelValue');

    expect(networkShipIdsOf({ rules: [{ verb: 'send', from: [{ owner: alice }, team], to: [{ owner: '*' }, { owner: '#' }] }], declarers: [] })).toEqual([alice]);
  });

  it('names the ships that declared rules, never the installation', () => {
    const squadrons = newId('ship');

    expect(networkShipIdsOf({ rules: [], declarers: [{ kind: 'ship', shipId: squadrons }, { kind: 'installation' }] })).toEqual([squadrons]);
  });

  it('names both ships of each pair whose reach the draft changes', () => {
    const [from, to, other] = [newId('ship'), newId('ship'), newId('ship')];
    const changes = { ...NO_CHANGES, send: { gained: [{ fromShipId: from, toShipId: to, rule: { rule: 0 } }], lost: [] }, read: { gained: [], lost: [{ fromShipId: to, toShipId: other, rule: { rule: 1 } }] } };

    expect(networkShipIdsOf({ rules: [], declarers: [], draftChanges: changes })).toEqual([from, to, other]);
  });

  it('names the picked ship and the ships it reaches, each once', () => {
    const [picked, reached] = [newId('ship'), newId('ship')];

    expect(networkShipIdsOf({ rules: [{ verb: 'send', from: [{ owner: picked }], to: [] }], declarers: [], pickedShipId: picked, reachableShipIds: [reached, picked] })).toEqual([picked, reached]);
  });
});
