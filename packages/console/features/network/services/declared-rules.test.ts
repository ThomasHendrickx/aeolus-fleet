import { createIdGenerator, type ListedShip, type NetworkRule, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { declaredRulesOf } from './declared-rules';

const newId = createIdGenerator();

function aListedShip(name: string): Pick<ListedShip, 'id' | 'name'> {
  return { id: newId('ship'), name };
}

function aRule(): NetworkRule {
  return { verb: 'send', from: [{ labelId: newId('label'), value: '#' }], to: [{ labelId: newId('label'), value: '#' }] };
}

function declaredBy(shipId: ShipId, rules: NetworkRule[] = [aRule()]): { declarer: { kind: 'ship'; shipId: ShipId }; rules: NetworkRule[] } {
  return { declarer: { kind: 'ship', shipId }, rules };
}

describe('the declared rules Network shows', () => {
  it('name the ship that declared them, with its whole list', () => {
    const squadrons = aListedShip('squadrons');
    const rules = [aRule(), aRule()];

    expect(declaredRulesOf([declaredBy(squadrons.id, rules)], [squadrons])).toEqual([{ declarerId: squadrons.id, declaredBy: 'squadrons', rules }]);
  });

  it('are listed by the name of the ship that declared them', () => {
    const squadrons = aListedShip('squadrons');
    const trierarchPlugin = aListedShip('trierarch-plugin');

    const declared = declaredRulesOf([declaredBy(trierarchPlugin.id), declaredBy(squadrons.id)], [squadrons, trierarchPlugin]);

    expect(declared.map((each) => each.declaredBy)).toEqual(['squadrons', 'trierarch-plugin']);
  });

  it('name the installation for the rules it declared (decision 0052)', () => {
    const rules = [aRule()];

    expect(declaredRulesOf([{ declarer: { kind: 'installation' }, rules }], [])).toEqual([{ declarerId: 'installation', declaredBy: 'the installation', rules }]);
  });

  it('leave out a ship that declares none', () => {
    const squadrons = aListedShip('squadrons');

    expect(declaredRulesOf([declaredBy(squadrons.id, [])], [squadrons])).toEqual([]);
  });

  it('name a ship the snapshot does not hold yet by its id', () => {
    const shipId = newId('ship');

    expect(declaredRulesOf([declaredBy(shipId)], [])[0]?.declaredBy).toBe(shipId);
  });
});
