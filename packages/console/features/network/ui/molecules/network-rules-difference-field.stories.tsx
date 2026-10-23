import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NetworkRulesDifferenceField } from './network-rules-difference-field';

const SHIPS = [
  { id: 'shp_01m3tb1zhjs6kthtcs2zvksacv', name: 'argo' },
  { id: 'shp_01m5m1yr8a8xze0vaw2k9e6s5d', name: 'thomas-person' },
] as const;

const meta = {
  title: 'Molecules/NetworkRulesDifferenceField',
  component: NetworkRulesDifferenceField,
  args: {
    difference: { kind: 'definer', key: 'crm', fileDefiner: 'argo', fleetDefiner: 'crm-app', ways: ['useExisting', 'dropRules'] },
    ships: SHIPS,
    isDisabled: false,
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NetworkRulesDifferenceField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A key with another definer: use it, or drop the rules on it. */
export const OtherDefiner: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('network-import-way-dropRules'));
    await expect(args.onChange).toHaveBeenCalledWith({ difference: args.difference, way: 'dropRules' });
  },
};
/** A key lacking a value the rules name: only dropping them. */
export const MissingValues: Story = {
  args: { difference: { kind: 'values', key: 'crm', fileValues: ['app', 'user'], fleetValues: ['app'], missingValues: ['user'], ways: ['dropRules'] } },
};
/** An owner name no active ship has, a ship to pick once Pick is chosen. */
export const PickingShip: Story = {
  args: {
    difference: { kind: 'ship', name: 'thomas', ways: ['pickShip', 'dropRules'] },
    choice: { difference: { kind: 'ship', name: 'thomas', ways: ['pickShip', 'dropRules'] }, way: 'pickShip' },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('network-import-pick-ship')).toBeVisible();
  },
};
export const Disabled: Story = { args: { isDisabled: true } };
