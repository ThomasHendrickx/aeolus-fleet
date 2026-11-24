import { Fragment, useId } from 'react';

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
  const hasFloor = floor.length > 0;
  const setsHint = names.length === 0 ? 'No rule sets are connected.' : (
    <><span className="font-mono">{shipName}</span>’s session is checked against {hasFloor ? 'the floor and ' : ''}this rule set.</>
  );
  const floorHint = hasFloor ? (
    <>
      The floor applies to every request: {floor.map((name, index) => (
        <Fragment key={name}>
          {index > 0 ? ', ' : null}
          <span className="font-mono">{name}</span>
        </Fragment>
      ))}.
    </>
  ) : 'None: no rules apply.';
  return <SettingsField id={id} label="Rule set" isOptional error={error} hint={<>{setsHint} {floorHint}</>}>
    <SettingsSelect id={id} testId="crew-settings-rule-set" value={value}
      items={{ '': 'None', ...Object.fromEntries(names.map((name) => [name, name])) }}
      isDisabled={isDisabled === true || names.length === 0} onPick={onChange} />
  </SettingsField>;
}
