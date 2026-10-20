import type { BuiltInRuleState } from '@aeolus-fleet/common';

/**
 * The built-in rules as Network shows them, first and apart from argo's own
 * (decision 0034): each as the fleet answers it, with what it allows and who
 * turns it. argo, the owner, the answer, a connected plugin's reading and the
 * installation's managing are never off; argo turns the viewer reading; open
 * is off while rules are applied and on while none are, for every verb.
 */

/** One built-in rule as a row: its name, what it allows, whether it is on and who turns it. */
export interface BuiltInRow {
  key: string;
  name: string;
  meaning: string;
  isOn: boolean;
  turnedBy: 'never' | 'argo' | 'rules';
}

function rowOf(state: BuiltInRuleState): BuiltInRow {
  switch (state.rule) {
    case 'argo':
      return { key: state.rule, name: 'argo', meaning: 'argo sends to, reads and manages every ship, and every ship reaches argo.', isOn: state.isOn, turnedBy: 'never' };
    case 'owner':
      return { key: state.rule, name: 'Owner', meaning: 'A ship’s owner sends to, reads and manages the ships it owns.', isOn: state.isOn, turnedBy: 'never' };
    case 'answer':
      return { key: state.rule, name: 'Answer', meaning: 'A ship may always answer the sender of a message it received.', isOn: state.isOn, turnedBy: 'never' };
    case 'pluginRead':
      return { key: state.rule, name: 'Connected plugins read', meaning: 'A plugin argo connected reads every ship, whatever the rules.', isOn: state.isOn, turnedBy: 'never' };
    case 'viewerRead':
      return { key: state.rule, name: 'Viewer reads', meaning: 'The viewer reads every ship.', isOn: state.isOn, turnedBy: 'argo' };
    case 'installation':
      return { key: state.rule, name: 'Installation manages', meaning: 'The installation manages person ships and the ships they own, so a leaver is always released.', isOn: state.isOn, turnedBy: 'never' };
    case 'open':
      return { key: state.rule, name: 'Open', meaning: 'Every ship may send to, read and manage every ship.', isOn: state.isOn, turnedBy: 'rules' };
  }
}

/** Every built-in rule as a row, in the order the fleet answers them. */
export function builtInRowsOf(states: readonly BuiltInRuleState[]): BuiltInRow[] {
  return states.map(rowOf);
}
