import { useId } from 'react';

import type { GuardChoices } from '../../lib/guard-choices';
import { SettingsField } from './settings-field';
import { SettingsSelect } from './settings-select';

/** A named rule set can tighten the floor, which applies to every request. */
export function RuleSetField({ shipName, value, choices, isDisabled, error, onChange }: {
  shipName: string;
  value: string;
  choices: GuardChoices;
  isDisabled?: boolean;
  error?: string;
  onChange: (name: string) => void;
}) {
  const id = useId();
  const { names, floor } = choices;
  const setsHint = names.length === 0 ? 'No rule sets are connected.' : `${shipName}’s session is checked against the floor and this rule set.`;
  const floorHint = floor.length === 0 ? 'None: no rules apply.' : `The floor applies to every request: ${floor.join(', ')}.`;
  return <SettingsField id={id} label="Rule set" isOptional error={error} hint={`${setsHint} ${floorHint}`}>
    <SettingsSelect id={id} testId="crew-settings-rule-set" value={value}
      items={{ '': 'None', ...Object.fromEntries(names.map((name) => [name, name])) }}
      isDisabled={isDisabled === true || names.length === 0} onPick={onChange} />
  </SettingsField>;
}
