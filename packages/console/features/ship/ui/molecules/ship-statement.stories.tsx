import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { ShipStatement } from './ship-statement';

const meta = {
  title: 'Molecules/ShipStatement',
  component: ShipStatement,
  args: {
    statement: {
      by: 'crew',
      version: 2,
      summary: 'Reviews pull requests on aeolus-fleet.',
      capabilities: [
        { name: 'review_pr', title: 'Review a pull request', description: 'Send the PR link; a review comes back.' },
        { name: 'explain_diff' },
      ],
    },
  },
} satisfies Meta<typeof ShipStatement>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Its crew's summary and what it offers. */
export const StatedByCrew: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Reviews pull requests on aeolus-fleet.')).toBeVisible();
    await expect(canvas.getByRole('list', { name: 'Offers' })).toHaveTextContent('review_pr');
  },
};
export const SummaryOnly: Story = { args: { statement: { by: 'crew', version: 1, summary: 'Plans the next slice.', capabilities: [] } } };
/** No crew stated one yet: the commission note stands in. */
export const CommissionNote: Story = {
  args: { statement: { by: 'commission', note: 'Keeps the release keys' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Commission note, until a crew states one')).toBeVisible();
  },
};
export const NoStatement: Story = { args: { statement: null } };
