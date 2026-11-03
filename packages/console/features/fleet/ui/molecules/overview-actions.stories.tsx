import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus } from 'lucide-react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '@aeolus-fleet/ui';
import { OverviewActions } from './overview-actions';

const PHONE = { viewport: { value: 'mobile1' } };

/**
 * The fleet overview's page actions (docs/design/fleet-overview): one "..."
 * menu (labels, scopes, and sealing only while the fleet's sealing flag is
 * on) and Commission ship, small on a phone too.
 */
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

/** The menu's entries once it is open, as the page lists them. */
async function openedMenu(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'More actions' }));
  return within(canvasElement.ownerDocument.body).findByRole('menu');
}

/** Flag on, fleet manager (fleet:keys): the menu holds Manage labels, Manage scopes and Manage sealing, beside Commission. */
export const ManageSealing: Story = {
  play: async ({ canvasElement }) => {
    const menu = await openedMenu(canvasElement);

    await expect(within(menu).getAllByRole('menuitem').map((item) => [item.textContent, item.getAttribute('href')])).toEqual([
      ['Manage labels', '/labels'],
      ['Manage scopes', '/scopes'],
      ['Manage sealing', '/sealing'],
    ]);
    await expect(within(canvasElement).getByRole('button', { name: 'Commission' })).toBeVisible();
  },
};

/** Flag on, without labels:define, scopes:define or fleet:keys: View labels, View scopes and View sealing. */
export const ViewSealing: Story = {
  args: { canDefineLabels: false, canDefineScopes: false, sealing: 'view' },
  play: async ({ canvasElement }) => {
    const menu = await openedMenu(canvasElement);

    await expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['View labels', 'View scopes', 'View sealing']);
  },
};

/** Sealing flag off: the entry is gone, for every actor. */
export const SealingFlagOff: Story = {
  args: { sealing: 'off' },
  play: async ({ canvasElement }) => {
    const menu = await openedMenu(canvasElement);

    await expect(within(menu).queryByRole('menuitem', { name: /sealing/ })).toBeNull();
  },
};

export const ManageSealingPhone: Story = { ...ManageSealing, globals: PHONE };

export const ViewSealingPhone: Story = { ...ViewSealing, globals: PHONE };

export const SealingFlagOffPhone: Story = { ...SealingFlagOff, globals: PHONE };
