import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import { ANSWERED, ISSUE_FILED, NOW, PR_READY, TIDE_TABLES, WITHDRAWN } from '../../../../lib/fixtures/inbox.fixtures';
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
