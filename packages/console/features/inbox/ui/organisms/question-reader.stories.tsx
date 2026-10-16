import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { ANSWERED, MERGE_NOW, NOW, TIDE_TABLES, WITHDRAWN } from '../../../../lib/fixtures/inbox.fixtures';
import { QuestionReader } from './question-reader';

const meta = {
  title: 'Organisms/QuestionReader',
  component: QuestionReader,
  args: {
    question: TIDE_TABLES,
    position: { number: 1, count: 2, next: MERGE_NOW.deliveryId, left: 1 },
    isPhone: false,
    onAnswer: fn(),
    onSelect: fn(),
    isPending: false,
    now: NOW,
  },
  decorators: [(Story) => <div className="flex h-160 flex-col">{Story()}</div>],
} satisfies Meta<typeof QuestionReader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The asker's pick chosen with its why; Answer names it. */
export const Open: Story = {};

export const Phone: Story = { args: { isPhone: true }, globals: { viewport: { value: 'mobile1' } } };

/** What was sent, how many are left and Next question. */
export const Answered: Story = { args: { question: ANSWERED, position: { number: undefined, count: 1, next: MERGE_NOW.deliveryId, left: 1 } } };

export const Withdrawn: Story = { args: { question: WITHDRAWN, position: { number: undefined, count: 0, next: undefined, left: 0 } } };

export const Pending: Story = { args: { isPending: true } };

export const ReadOnly: Story = { args: { isReadOnly: true } };
