import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ArgoBanner } from './argo-banner';

const meta = {
  title: 'Molecules/ArgoBanner',
  component: ArgoBanner,
  args: { onSignOutOfArgo: fn(), isSigningOut: false },
} satisfies Meta<typeof ArgoBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An account signed in as argo (accounts design, A7): it says so above every page, with the way back to the account. */
export const SignedInAsArgo: Story = {
  play: async ({ args, canvasElement }) => {
    const banner = within(canvasElement).getByTestId('argo-banner');
    await expect(banner).toHaveTextContent('You are signed in as argo');
    await userEvent.click(within(banner).getByRole('button', { name: 'Sign out of argo' }));
    await expect(args.onSignOutOfArgo).toHaveBeenCalledOnce();
  },
};

/** Signing out of argo: the button waits. */
export const SigningOut: Story = {
  args: { isSigningOut: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Sign out of argo' })).toBeDisabled();
  },
};
