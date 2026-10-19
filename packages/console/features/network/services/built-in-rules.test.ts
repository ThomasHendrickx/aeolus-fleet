import type { BuiltInRuleState } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { builtInRowsOf } from './built-in-rules';

const ALL_ON: BuiltInRuleState[] = [
  { rule: 'argo', isOn: true },
  { rule: 'owner', isOn: true },
  { rule: 'answer', isOn: true },
  { rule: 'pluginRead', isOn: true },
  { rule: 'viewerRead', isOn: true },
  { rule: 'installation', isOn: true },
  { rule: 'open', verb: 'send', isOn: true },
  { rule: 'open', verb: 'read', isOn: true },
  { rule: 'open', verb: 'manage', isOn: true },
];

describe('the built-in rules as Network shows them (decision 0034)', () => {
  it('shows every built-in rule in the order the fleet answers them, each named with what it allows', () => {
    expect(builtInRowsOf(ALL_ON).map((row) => [row.name, row.meaning])).toEqual([
      ['argo', 'argo sends to, reads and manages every ship, and every ship reaches argo.'],
      ['Owner', 'A ship’s owner sends to, reads and manages the ships it owns.'],
      ['Answer', 'A ship may always answer the sender of a message it received.'],
      ['Connected plugins read', 'A plugin argo connected reads every ship, whatever the rules.'],
      ['Viewer reads', 'The viewer reads every ship.'],
      ['Installation manages', 'The installation manages person ships and the ships they own, so a leaver is always released.'],
      ['Open for send', 'Every ship may send to every ship.'],
      ['Open for read', 'Every ship may read every ship.'],
      ['Open for manage', 'Every ship may manage every ship.'],
    ]);
  });

  it('marks argo, the owner, the answer, a connected plugin’s reading and the installation’s managing never off, the viewer reading argo’s to turn and open the networking plugin’s', () => {
    expect(builtInRowsOf(ALL_ON).map((row) => row.turnedBy)).toEqual(['never', 'never', 'never', 'never', 'argo', 'never', 'plugin', 'plugin', 'plugin']);
  });

  it('says each rule that can be off as the fleet answers it', () => {
    const states: BuiltInRuleState[] = ALL_ON.map((state) => (state.rule === 'viewerRead' || (state.rule === 'open' && state.verb === 'read') ? { ...state, isOn: false } : state));

    expect(builtInRowsOf(states).map((row) => row.isOn)).toEqual([true, true, true, true, false, true, true, false, true]);
  });

  it('keys each row by its rule and verb, so a list keeps its rows', () => {
    expect(builtInRowsOf(ALL_ON).map((row) => row.key)).toEqual(['argo', 'owner', 'answer', 'pluginRead', 'viewerRead', 'installation', 'open-send', 'open-read', 'open-manage']);
  });
});
