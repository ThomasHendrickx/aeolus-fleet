import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { DISCARDED, PR_READY } from '../../../../lib/fixtures/inbox.fixtures';
import { MessageBody } from './message-body';

const meta = {
  title: 'Molecules/MessageBody',
  component: MessageBody,
  args: { blocks: PR_READY.text.body, lineCount: PR_READY.text.lineCount },
} satisfies Meta<typeof MessageBody>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Markdown: a paragraph, a list and a link. */
export const Markdown: Story = {};

/** Over 12 lines: folded behind Show all. */
export const Long: Story = { args: { blocks: DISCARDED.text.body, lineCount: DISCARDED.text.lineCount } };
