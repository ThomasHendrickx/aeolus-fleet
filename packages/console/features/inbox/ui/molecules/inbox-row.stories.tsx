import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import { ANSWERED, ISSUE_FILED, KEY_NOT_REACHABLE_PR_READY, NOW, PR_READY, SEALED_PR_READY, TIDE_TABLES, WITHDRAWN } from '../../../../lib/fixtures/inbox.fixtures';
import { InboxRow } from './inbox-row';

const meta = {
  title: 'Molecules/InboxRow',
  component: InboxRow,
  args: { entry: TIDE_TABLES, isSelected: false, onSelect: fn(), now: NOW },
  decorators: [(Story) => <ul className="max-w-sm">{Story()}</ul>],
} satisfies Meta<typeof InboxRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An open question: not answered, the asker's pick, and how long it has waited; nothing in it reads as answered (#870). */
export const OpenQuestion: Story = {
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByTestId('inbox-question-row');
    await expect(row).toHaveTextContent('Not answered, pick: 2. 14 days');
    await expect(row.querySelector('[data-answered]')).toBeNull();
  },
};

/** Answered: what was sent, marked answered. */
export const AnsweredQuestion: Story = {
  args: { entry: ANSWERED },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('inbox-question-row').querySelector('[data-answered]')).not.toBeNull();
  },
};

export const WithdrawnQuestion: Story = { args: { entry: WITHDRAWN } };

/** An unread message: the dot, the headline in bold and one line of its body. */
export const UnreadMessage: Story = { args: { entry: PR_READY } };

export const ReadMessage: Story = { args: { entry: ISSUE_FILED } };

export const Selected: Story = { args: { entry: PR_READY, isSelected: true } };

/** A sealed payload: a lock by the time, the headline as today (decision 0068, N1). */
export const SealedMessage: Story = {
  args: { entry: SEALED_PR_READY },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'Sealed' })).toBeVisible();
    await expect(within(canvasElement).getByTestId('inbox-row')).toHaveTextContent('PR #412 is ready for you');
  },
};
/** A sealed question: the lock too. */
export const SealedQuestion: Story = { args: { entry: { ...TIDE_TABLES, sealing: 'sealed' } } };
/** The company key cut off: the row says so in place of the headline and body (scenario 25). */
export const KeyNotReachable: Story = {
  args: { entry: KEY_NOT_REACHABLE_PR_READY },
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByTestId('inbox-row');
    await expect(row).toHaveTextContent('Sealed, key not reachable');
    await expect(row).not.toHaveTextContent('PR #412');
  },
};
