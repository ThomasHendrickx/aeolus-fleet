import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import { ARGO, NOW, PING_TIMELINE, PLANNER, REVIEWER, SIGNED_IN_ACCOUNT_ID, SIGNED_IN_PING_TIMELINE, TIMELINE } from '../../../../lib/fixtures/ship-page.fixtures';
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
/** Retirement names the recorded new owner, including argo as the fallback. */
export const OwnerRetired: Story = {
  args: {
    entries: [PLANNER, ARGO].map((owner, index) => ({
      seq: index + 1,
      id: `evt_01j8xk4tqzr3a9w6m2v5n7yb4${String(index)}`,
      type: 'OwnerChanged',
      occurredAt: NOW.toISOString(),
      actor: REVIEWER,
      signedInAccountId: null,
      ship: REVIEWER,
      message: null,
      details: { why: 'ownerRetired', toShipId: owner.id },
    })),
    ownerNames: new Map([[PLANNER.id, PLANNER.name], [ARGO.id, ARGO.name]]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const owner of [PLANNER, ARGO]) {
      const link = canvas.getByRole('link', { name: owner.name });
      await expect(link).toHaveAttribute('href', `/ships/${owner.id}`);
      await expect(link.closest('[data-testid="ship-timeline-entry"]')).toHaveTextContent(' owns it now');
    }
  },
};
/** A ping from argo, taken and answered with pong. */
export const Pinged: Story = { args: { entries: [...PING_TIMELINE, ...TIMELINE] } };
/** argo pinged it while an account was signed in as argo, which the account app names (decision 0054): the row says by whom, beside its time. */
export const BySignedInAccount: Story = {
  args: { entries: SIGNED_IN_PING_TIMELINE, accountNames: { [SIGNED_IN_ACCOUNT_ID]: 'mathilde@acme.example' } },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByTestId('ship-timeline-account');
    await expect(rows.map((row) => row.textContent)).toEqual([' · by mathilde@acme.example']);
  },
};
/** The same while the account app gives no name, or none runs: the account shows by its id. */
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
