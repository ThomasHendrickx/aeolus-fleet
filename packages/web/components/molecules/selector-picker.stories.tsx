import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';

import { SelectorPicker, type SelectorMode, type SelectorValue } from './selector-picker';
import { COMPOSE_SHIPS, COMPOSE_TYPES, REVIEWER_01 } from './selector-picker.fixtures';

function Picker({
  initialMode = 'ship',
  initial = null,
  error,
}: {
  initialMode?: SelectorMode;
  initial?: SelectorValue | null;
  error?: string;
}) {
  const [mode, setMode] = useState<SelectorMode>(initialMode);
  const [value, setValue] = useState<SelectorValue | null>(initial);
  return (
    <div className="max-w-90">
      <SelectorPicker
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          setValue(null);
        }}
        value={value}
        onChange={setValue}
        ships={COMPOSE_SHIPS}
        types={COMPOSE_TYPES}
        error={error}
      />
    </div>
  );
}

const meta = {
  title: 'Molecules/SelectorPicker',
  component: Picker,
} satisfies Meta<typeof Picker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Type a name ("revi") to open the matching ships: open, searching. */
export const Empty: Story = {};

export const Filled: Story = { args: { initial: { kind: 'ship', shipId: REVIEWER_01.id } } };

export const TypeFilled: Story = { args: { initialMode: 'type', initial: { kind: 'type', type: 'reviewer' } } };

/** The server refused the type: no active ship has it. */
export const TypeInvalid: Story = {
  args: { initialMode: 'type', initial: { kind: 'type', type: 'deployer' }, error: 'No ship of type deployer exists.' },
};
