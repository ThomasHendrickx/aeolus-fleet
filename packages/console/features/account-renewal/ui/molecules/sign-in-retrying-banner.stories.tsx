import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { SignInRetryingBanner } from './sign-in-retrying-banner';

const meta = {
  title: 'Molecules/SignInRetryingBanner',
  component: SignInRetryingBanner,
} satisfies Meta<typeof SignInRetryingBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** pagasae does not answer the renewal: the banner says so above the page, which works on. */
export const Retrying: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Can’t reach the sign-in service. Retrying.');
  },
};
