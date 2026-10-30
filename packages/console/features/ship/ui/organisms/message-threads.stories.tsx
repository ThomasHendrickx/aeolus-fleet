import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { MessageThreads } from './message-threads';
import { HANDED_MESSAGES, KEY_NOT_REACHABLE_MESSAGES, MESSAGES, NOW, REVIEWER, SEALED_MESSAGES, SQUADRON_MESSAGES } from '../../../../lib/fixtures/ship-page.fixtures';

const meta = {
  title: 'Organisms/MessageThreads',
  component: MessageThreads,
  args: { shipId: REVIEWER.id, messages: MESSAGES, state: 'ready', now: NOW, onOpenMessage: fn(), onRetry: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-180">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageThreads>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Threads: Story = {};
export const Empty: Story = { args: { messages: [] } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = { args: { state: 'error' } };
/** A member's check-in and role: each in words, its raw payload in the message sheet. */
export const SquadronCheckIn: Story = { args: { messages: SQUADRON_MESSAGES } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** A row reads its state word as the MessageSheet does (#796): a pushed hand-over "Handed", a plain receive's "Handed (pulled)". */
export const HandedPushedAndPulled: Story = {
  args: { messages: HANDED_MESSAGES },
  play: async ({ canvas }) => {
    const rows = canvas.getAllByTestId('message-row');
    await expect(rows[0]).toHaveTextContent(/Handed(?! \(pulled\))/);
    await expect(rows[1]).toHaveTextContent('Handed (pulled)');
  },
};

/** A sealed fleet: a lock by each line, the payload rendered as today (decision 0068, N1). */
export const Sealed: Story = {
  args: { messages: SEALED_MESSAGES },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('img', { name: 'Sealed' })).toHaveLength(SEALED_MESSAGES.length);
    await expect(canvas.queryByText('Sealed, key not reachable')).toBeNull();
  },
};
/** The company key cut off: each line says so; direction, party and state stay (scenario 25). */
export const KeyNotReachable: Story = {
  args: { messages: KEY_NOT_REACHABLE_MESSAGES },
  play: async ({ canvas }) => {
    const lines = canvas.getAllByTestId('message-line');
    await expect(lines).toHaveLength(KEY_NOT_REACHABLE_MESSAGES.length);
    for (const line of lines) {
      await expect(line).toHaveTextContent('Sealed, key not reachable');
    }
    await expect(canvas.getAllByText('Acknowledged').length).toBeGreaterThan(0);
  },
};
export const PhoneKeyNotReachable: Story = { args: { messages: KEY_NOT_REACHABLE_MESSAGES }, globals: { viewport: { value: 'mobile1' } } };
