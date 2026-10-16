import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

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

/** An open question: the pick and how long it has waited. */
export const OpenQuestion: Story = {};

export const AnsweredQuestion: Story = { args: { entry: ANSWERED } };

export const WithdrawnQuestion: Story = { args: { entry: WITHDRAWN } };

/** An unread message: the dot, the headline in bold and one line of its body. */
export const UnreadMessage: Story = { args: { entry: PR_READY } };

export const ReadMessage: Story = { args: { entry: ISSUE_FILED } };

export const Selected: Story = { args: { entry: PR_READY, isSelected: true } };
