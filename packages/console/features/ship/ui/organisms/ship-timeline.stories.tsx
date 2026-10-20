import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import { NOW, PING_TIMELINE, REVIEWER, SIGNED_IN_ACCOUNT_ID, SIGNED_IN_PING_TIMELINE, TIMELINE } from '../../../../lib/fixtures/ship-page.fixtures';
import { ShipTimeline } from './ship-timeline';

const meta = {
  title: 'Organisms/ShipTimeline',
  component: ShipTimeline,
  args: { shipId: REVIEWER.id, entries: TIMELINE, state: 'ready', now: NOW, onOpenMessage: fn(), onRetry: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-140">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShipTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** A ping from argo, taken and answered with pong. */
export const Pinged: Story = { args: { entries: [...PING_TIMELINE, ...TIMELINE] } };
/** argo pinged it while an account was signed in as argo, which pagasae names (decision 0054): the row says by whom, beside its time. */
export const BySignedInAccount: Story = {
  args: { entries: SIGNED_IN_PING_TIMELINE, accountNames: { [SIGNED_IN_ACCOUNT_ID]: 'mathilde@acme.example' } },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByTestId('ship-timeline-account');
    await expect(rows.map((row) => row.textContent)).toEqual([' · by mathilde@acme.example']);
  },
};
/** The same while pagasae gives no name, or none runs: the account shows by its id. */
export const BySignedInAccountUnnamed: Story = {
  args: { entries: SIGNED_IN_PING_TIMELINE },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('ship-timeline-account')).toHaveTextContent('by acc-01mathilde');
  },
};
export const JustCommissioned: Story = { args: { entries: TIMELINE.slice(-1) } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = { args: { state: 'error' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
