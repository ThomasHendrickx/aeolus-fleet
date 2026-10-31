import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus } from 'lucide-react';
import { expect, within } from 'storybook/test';

import { Button } from '@aeolus-fleet/ui';
import { OverviewActions } from './overview-actions';

const PHONE = { viewport: { value: 'mobile1' } };

/** The feature flags console mockup's Fleet overview states: the sealing entry only while the fleet's sealing flag is on. */
const meta = {
  title: 'Molecules/OverviewActions',
  component: OverviewActions,
  args: {
    canDefineLabels: true,
    canDefineScopes: true,
    sealing: 'manage',
    commission: (
      <Button variant="primary" icon={<Plus aria-hidden />}>
        Commission
      </Button>
    ),
  },
} satisfies Meta<typeof OverviewActions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Flag on, fleet manager (fleet:keys): Manage sealing, as today. */
export const ManageSealing: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Manage sealing' })).toHaveAttribute('href', '/sealing');
  },
};

/** Flag on, without fleet:keys: View sealing, as today. */
export const ViewSealing: Story = {
  args: { sealing: 'view' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'View sealing' })).toBeVisible();
  },
};

/** Sealing flag off: the entry is gone, for every actor. */
export const SealingFlagOff: Story = {
  args: { sealing: 'off' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: /sealing/ })).toBeNull();
  },
};

export const ManageSealingPhone: Story = { ...ManageSealing, globals: PHONE };

export const ViewSealingPhone: Story = { ...ViewSealing, globals: PHONE };

export const SealingFlagOffPhone: Story = { ...SealingFlagOff, globals: PHONE };
