import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { LoadMore } from '../../../../components/molecules/load-more';
import { MessageDeliveries } from './message-deliveries';
import { LABEL_DELIVERIES, NOW } from '../../../../lib/fixtures/ship-page.fixtures';

const meta = {
  title: 'Organisms/MessageDeliveries',
  component: MessageDeliveries,
  args: { deliveries: LABEL_DELIVERIES, state: 'ready', onRetry: fn(), now: NOW },
} satisfies Meta<typeof MessageDeliveries>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The last page: every delivery shown, no Load more. */
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('message-delivery')).toHaveLength(3);
    await expect(canvas.queryByTestId('message-deliveries-load-more')).not.toBeInTheDocument();
  },
};
/** More deliveries follow: Load more ends the list and asks for the next page. */
export const More: Story = {
  args: { more: <LoadMore what="more deliveries" isLoading={false} isFailed={false} onLoad={fn()} area="message-deliveries" /> },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByTestId('message-deliveries-load-more');
    await userEvent.click(button);
    await expect(button).toHaveTextContent('Load more deliveries');
  },
};
export const LoadingMore: Story = { args: { more: <LoadMore what="more deliveries" isLoading isFailed={false} onLoad={fn()} area="message-deliveries" /> } };
export const LoadMoreFailed: Story = { args: { more: <LoadMore what="more deliveries" isLoading={false} isFailed onLoad={fn()} area="message-deliveries" /> } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = {
  args: { state: 'error' },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
export const Dark: Story = { globals: { theme: 'dark' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** Monitoring W2: only the recipient whose task names the message has progress. */
export const RecipientProgress: Story = {
  args: {
    deliveries: LABEL_DELIVERIES.map((delivery, index) => ({
      ...delivery,
      progress: index === 0 ? { state: 'working', note: 'Drafting the guide', step: { at: 1, of: 4 }, reportChangedAt: '2026-10-01T09:54:00.000Z' } : null,
    })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('message-recipient-progress')).toHaveLength(1);
    await expect(canvas.getByTestId('message-recipient-progress')).toHaveTextContent('Working');
    await expect(canvas.getByTestId('message-recipient-progress')).toHaveTextContent('step 1 of 4');
    await expect(canvas.getByTestId('message-recipient-progress')).toHaveTextContent('Drafting the guide');
    await expect(canvas.getByTestId('message-recipient-progress')).toHaveTextContent('changed');
  },
};
export const RecipientProgressPhone: Story = { ...RecipientProgress, globals: { viewport: { value: 'mobile1' } } };
export const RecipientProgressDark: Story = { ...RecipientProgress, globals: { theme: 'dark' } };

export const RecipientBlocked: Story = { args: { deliveries: LABEL_DELIVERIES.map((delivery, index) => ({ ...delivery, progress: index === 0 ? { state: 'blocked', note: 'Waiting for the owner', step: { at: 2, of: 4 }, reportChangedAt: NOW.toISOString() } : null })) } };
export const RecipientIdle: Story = { args: { deliveries: LABEL_DELIVERIES.map((delivery, index) => ({ ...delivery, progress: index === 0 ? { state: 'idle', note: null, step: null, reportChangedAt: NOW.toISOString() } : null })) } };
