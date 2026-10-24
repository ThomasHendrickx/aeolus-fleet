import type { BuiltInRule, BuiltInRuleState } from '@aeolus-fleet/common';

/**
 * The built-in rules as Network shows them, first and apart from argo's own
 * (decision 0034): each as the fleet answers it, with what it allows and who
 * turns it. argo, the owner, the answer, a connected plugin's reading, a
 * meeting's participants (decision 0061) and the installation's managing are
 * never off; argo turns the viewer reading; open is off while rules are
 * applied and on while none are, for every verb.
 */

/** One built-in rule as a row: its name, what it allows, whether it is on and who turns it. */
export interface BuiltInRow {
  key: string;
  name: string;
  meaning: string;
  isOn: boolean;
  turnedBy: 'never' | 'argo' | 'rules';
}

/** Each built-in rule by the name Network gives it, here and wherever a rule that allows a reach is named. */
export const BUILT_IN_NAMES: Readonly<Record<BuiltInRule, string>> = {
  argo: 'argo',
  owner: 'Owner',
  answer: 'Answer',
  pluginRead: 'Connected plugins read',
  meeting: 'Meeting',
  viewerRead: 'Viewer reads',
  installation: 'Installation manages',
  open: 'Open',
};

function rowOf(state: BuiltInRuleState): BuiltInRow {
  switch (state.rule) {
    case 'argo':
      return { key: state.rule, name: BUILT_IN_NAMES[state.rule], meaning: 'argo sends to, reads and manages every ship, and every ship reaches argo.', isOn: state.isOn, turnedBy: 'never' };
    case 'owner':
      return { key: state.rule, name: BUILT_IN_NAMES[state.rule], meaning: 'A ship’s owner sends to, reads and manages the ships it owns.', isOn: state.isOn, turnedBy: 'never' };
    case 'answer':
      return { key: state.rule, name: BUILT_IN_NAMES[state.rule], meaning: 'A ship may always answer the sender of a message it received.', isOn: state.isOn, turnedBy: 'never' };
    case 'pluginRead':
      return { key: state.rule, name: BUILT_IN_NAMES[state.rule], meaning: 'A plugin argo connected reads every ship, whatever the rules.', isOn: state.isOn, turnedBy: 'never' };
    case 'meeting':
      return { key: state.rule, name: BUILT_IN_NAMES[state.rule], meaning: 'The participants of a meeting reach each other in it, whatever the rules: its owner reached each when it joined.', isOn: state.isOn, turnedBy: 'never' };
    case 'viewerRead':
      return { key: state.rule, name: BUILT_IN_NAMES[state.rule], meaning: 'The viewer reads every ship.', isOn: state.isOn, turnedBy: 'argo' };
    case 'installation':
      return { key: state.rule, name: BUILT_IN_NAMES[state.rule], meaning: 'The installation manages person ships and the ships they own, so a leaver is always released.', isOn: state.isOn, turnedBy: 'never' };
    case 'open':
      return { key: state.rule, name: BUILT_IN_NAMES[state.rule], meaning: 'Every ship may send to, read and manage every ship.', isOn: state.isOn, turnedBy: 'rules' };
  }
}

/** Every built-in rule as a row, in the order the fleet answers them. */
export function builtInRowsOf(states: readonly BuiltInRuleState[]): BuiltInRow[] {
  return states.map(rowOf);
}
