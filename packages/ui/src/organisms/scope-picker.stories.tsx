import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import { ScopePicker } from './scope-picker.js';

const LISTED = [
  { scope: 'fleet:read', description: 'See the fleet: its ships, their state and their deliveries' },
  { scope: 'fleet:commission', description: 'Commission ships' },
  { scope: 'labels:define', description: 'Define labels and their values' },
];

const meta = {
  title: 'Organisms/ScopePicker',
  component: ScopePicker,
  args: { label: 'Scopes', listed: LISTED, picked: [], onPick: fn() },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ScopePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NonePicked: Story = {};
export const Picked: Story = { args: { picked: ['fleet:read', 'labels:define'] } };
/** A scope picked before that the fleet no longer lists stays picked, so it can be seen and removed. */
export const NoLongerListed: Story = {
  args: { picked: ['fleet:read', 'acme:deploy'] },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('scope-picker-search'));
    await expect(await screen.findByText('No longer defined in the fleet')).toBeVisible();
  },
};
/** While what was picked is saved: nothing can be picked or removed. */
export const Disabled: Story = { args: { picked: ['fleet:read'], isDisabled: true } };
export const NothingListed: Story = { args: { listed: [] } };

/** Searching by description, picking, removing a chip, and Escape keeping what was picked. */
export const Picking: Story = {
  render: function Render({ onPick, ...args }) {
    const [picked, setPicked] = useState<string[]>([]);
    return (
      <ScopePicker
        {...args}
        picked={picked}
        onPick={(next) => {
          onPick(next);
          setPicked(next);
        }}
      />
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId('scope-picker-search'), 'labels');
    const options = await screen.findAllByTestId('scope-picker-option');
    await expect(options).toHaveLength(1);
    await expect(options[0]).toHaveTextContent('labels:define');
    await expect(options[0]).toHaveTextContent('Define labels and their values');
    await userEvent.click(options[0]!);
    await expect(args.onPick).toHaveBeenLastCalledWith(['labels:define']);
    await expect(canvas.getByTestId('scope-picker-chip')).toHaveTextContent('labels:define');

    await userEvent.keyboard('{Escape}');
    await expect(canvas.getByTestId('scope-picker-chip')).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'Remove labels:define' }));
    await expect(args.onPick).toHaveBeenLastCalledWith([]);
    await waitFor(() => expect(canvas.queryByTestId('scope-picker-chip')).toBeNull());
  },
};
