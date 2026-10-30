import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { PageNotFound } from './page-not-found';

/** The feature flags console mockup's /sealing with the sealing flag off: the console's Not found. */
const meta = {
  title: 'Molecules/PageNotFound',
  component: PageNotFound,
} satisfies Meta<typeof PageNotFound>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to the fleet overview' })).toHaveAttribute('href', '/');
  },
};

export const Phone: Story = { ...Desktop, globals: { viewport: { value: 'mobile1' } } };
