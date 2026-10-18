import type { BuiltInRuleState, NetworkVerb } from '@aeolus-fleet/common';

/**
 * The built-in rules as Network shows them, first and apart from argo's own
 * (decision 0034): each as the fleet answers it, with what it allows and who
 * turns it. argo, the owner, the answer and a connected plugin's reading are
 * never off; argo turns the
 * viewer reading; the networking plugin turns open, per verb, off while
 * argo's rules apply and on for all-to-all.
 */

/** One built-in rule as a row: its name, what it allows, whether it is on and who turns it. */
export interface BuiltInRow {
  key: string;
  name: string;
  meaning: string;
  isOn: boolean;
  turnedBy: 'never' | 'argo' | 'plugin';
}

const OPEN_MEANINGS: Readonly<Record<NetworkVerb, string>> = {
  send: 'Every ship may send to every ship.',
  read: 'Every ship may read every ship.',
  manage: 'Every ship may manage every ship.',
};

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
    case 'open':
      return { key: `open-${state.verb}`, name: `Open for ${state.verb}`, meaning: OPEN_MEANINGS[state.verb], isOn: state.isOn, turnedBy: 'plugin' };
  }
}

/** Every built-in rule as a row, in the order the fleet answers them. */
export function builtInRowsOf(states: readonly BuiltInRuleState[]): BuiltInRow[] {
  return states.map(rowOf);
}
