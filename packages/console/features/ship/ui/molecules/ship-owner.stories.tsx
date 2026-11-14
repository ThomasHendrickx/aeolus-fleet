import { idSchema } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ShipOwner } from './ship-owner';

const CHARLOTTE_ID = idSchema('ship').parse('shp_01j8xk4tqzr3a9w6m2v5n7c4rm');
const ARGO_ID = idSchema('ship').parse('shp_01j8xk4tqzr3a9w6m2v5n7a7g0');

const meta = {
  title: 'Molecules/ShipOwner',
  component: ShipOwner,
  args: { owner: { kind: 'ship', id: CHARLOTTE_ID, name: 'charlotte', isYou: false }, onChange: fn() },
} satisfies Meta<typeof ShipOwner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The owner's ship, linked to its page, and Change owner beside it, which opens the dialog. */
export const ChangeOwnerOffered: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'charlotte' })).toHaveAttribute('href', `/ships/${CHARLOTTE_ID}`);
    await userEvent.click(canvas.getByRole('button', { name: 'Change owner' }));
    await expect(args.onChange).toHaveBeenCalledOnce();
  },
};
/** argo owns the ship and the session is argo's: "argo (you)". */
export const ArgoYou: Story = {
  args: { owner: { kind: 'ship', id: ARGO_ID, name: 'argo', isYou: true } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'argo (you)' })).toBeVisible();
  },
};
/** Without fleet:owner, or on a retired ship: the owner, no Change owner. */
export const ReadOnly: Story = {
  args: { onChange: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Change owner' })).toBeNull();
  },
};
/** A person ship owns itself, and nobody changes that. */
export const OwnsItself: Story = {
  args: { owner: { kind: 'itself' }, onChange: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Owns itself')).toBeVisible();
    await expect(within(canvasElement).queryByRole('link')).toBeNull();
  },
};
/** The owner's name still being read: its shape, not a blank. */
export const NameLoading: Story = { args: { owner: { kind: 'ship', id: CHARLOTTE_ID, name: undefined, isYou: false } } };
