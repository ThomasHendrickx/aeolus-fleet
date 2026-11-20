import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { NetworkSettingsRow } from './network-settings-row';

const meta = {
  title: 'Organisms/NetworkSettingsRow',
  component: NetworkSettingsRow,
} satisfies Meta<typeof NetworkSettingsRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On phone, Network is the first row of Settings (docs/design/app-navigation, where the account menu's items go). */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole('link', { name: 'Network' });
    await expect(row).toHaveAttribute('href', '/network');
    await expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  },
};

/** Desktop keeps its sidebar item: no row. */
export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link', { name: 'Network' })).toBeNull();
  },
};
