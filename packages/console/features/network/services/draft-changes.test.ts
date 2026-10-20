import { createIdGenerator, type ListedShip, type NetworkRulesDraftChanges } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { draftChangesOf, isUnchanged } from './draft-changes';

const newId = createIdGenerator();

function aListedShip(name: string): Pick<ListedShip, 'id' | 'name'> {
  return { id: newId('ship'), name };
}

const PLANNER = aListedShip('planner');
const SCOUT = aListedShip('scout');
const VAULT = aListedShip('vault');
const SQUADRONS = aListedShip('squadrons');
const SHIPS = [PLANNER, SCOUT, VAULT, SQUADRONS];

const NO_CHANGES: NetworkRulesDraftChanges = { send: { gained: [], lost: [] }, read: { gained: [], lost: [] }, manage: { gained: [], lost: [] } };

describe('what the draft would change, as Network lists it (decision 0035)', () => {
  it('names each pair of ships a verb gains and loses, sorted by name', () => {
    const changes: NetworkRulesDraftChanges = {
      ...NO_CHANGES,
      send: {
        gained: [
          { fromShipId: SCOUT.id, toShipId: VAULT.id, rule: { rule: 0 } },
          { fromShipId: PLANNER.id, toShipId: VAULT.id, rule: { rule: 0 } },
        ],
        lost: [{ fromShipId: PLANNER.id, toShipId: SCOUT.id, rule: { builtIn: 'open' } }],
      },
    };

    expect(draftChangesOf(changes, SHIPS)[0]).toEqual({
      verb: 'send',
      gained: [
        { key: `${PLANNER.id}>${VAULT.id}`, from: 'planner', to: 'vault', rule: 'Rule 1' },
        { key: `${SCOUT.id}>${VAULT.id}`, from: 'scout', to: 'vault', rule: 'Rule 1' },
      ],
      lost: [{ key: `${PLANNER.id}>${SCOUT.id}`, from: 'planner', to: 'scout', rule: 'Built-in: Open' }],
    });
  });

  it('names a declared rule by its declarer and number, the installation by name', () => {
    const changes: NetworkRulesDraftChanges = {
      ...NO_CHANGES,
      read: {
        gained: [
          { fromShipId: PLANNER.id, toShipId: SCOUT.id, rule: { declared: { kind: 'ship', shipId: SQUADRONS.id }, index: 1 } },
          { fromShipId: SCOUT.id, toShipId: PLANNER.id, rule: { declared: { kind: 'installation' }, index: 0 } },
        ],
        lost: [],
      },
    };

    expect(draftChangesOf(changes, SHIPS)[1]?.gained.map(({ rule }) => rule)).toEqual(['Declared by squadrons, rule 2', 'Declared by the installation, rule 1']);
  });

  it('keeps the verbs in the fleet order, and a ship the snapshot does not hold yet by its id', () => {
    const stranger = newId('ship');
    const changes: NetworkRulesDraftChanges = { ...NO_CHANGES, manage: { gained: [], lost: [{ fromShipId: stranger, toShipId: VAULT.id, rule: { builtIn: 'open' } }] } };

    const listed = draftChangesOf(changes, SHIPS);

    expect([listed.map(({ verb }) => verb), listed[2]?.lost[0]?.from]).toEqual([['send', 'read', 'manage'], stranger]);
  });

  it('says a draft changes nothing only when no verb gains or loses a pair', () => {
    const lost: NetworkRulesDraftChanges = { ...NO_CHANGES, read: { gained: [], lost: [{ fromShipId: PLANNER.id, toShipId: SCOUT.id, rule: { rule: 2 } }] } };

    expect([isUnchanged(draftChangesOf(NO_CHANGES, SHIPS)), isUnchanged(draftChangesOf(lost, SHIPS))]).toEqual([true, false]);
  });
});
