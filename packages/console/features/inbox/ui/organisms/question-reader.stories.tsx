import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

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

/** The asker's pick chosen with its why; Answer names it, and one tap sends it once. */
export const Open: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('inbox-answer'));

    await expect(args.onAnswer).toHaveBeenCalledExactlyOnceWith({ option: 2 });
  },
};

/** An option with a note: one tap sends both, once. */
export const WithNote: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId('inbox-note'), 'Tell core first.');
    await userEvent.click(canvas.getByTestId('inbox-answer'));

    await expect(args.onAnswer).toHaveBeenCalledExactlyOnceWith({ option: 2, note: 'Tell core first.' });
  },
};

/** The pick taken back with a second tap: the note goes alone, once. */
export const NoteAlone: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('14 days'));
    await userEvent.type(canvas.getByTestId('inbox-note'), 'Which stations?');
    await userEvent.click(canvas.getByTestId('inbox-answer'));

    await expect(args.onAnswer).toHaveBeenCalledExactlyOnceWith({ note: 'Which stations?' });
  },
};

export const Phone: Story = { args: { isPhone: true }, globals: { viewport: { value: 'mobile1' } } };

/** What was sent, how many are left and Next question. */
export const Answered: Story = { args: { question: ANSWERED, position: { number: undefined, count: 1, next: MERGE_NOW.deliveryId, left: 1 } } };

export const Withdrawn: Story = { args: { question: WITHDRAWN, position: { number: undefined, count: 0, next: undefined, left: 0 } } };

/** Sending: a second tap sends nothing more. */
export const Pending: Story = {
  args: { isPending: true },
  play: async ({ args, canvasElement }) => {
    // The loading button takes no pointer; the check is off so the tap lands and proves the form sends nothing.
    await userEvent.setup({ pointerEventsCheck: 0 }).click(within(canvasElement).getByTestId('inbox-answer'));

    await expect(args.onAnswer).not.toHaveBeenCalled();
  },
};

/** The answer was not sent (#870): it says why, keeps the option and the note, and Answer sends it again, once. */
export const Failed: Story = {
  args: { failure: { answer: { option: 3, note: 'Three stations at most.' }, message: 'The fleet did not answer: try again in a moment' } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Your answer was not sent: The fleet did not answer: try again in a moment');
    await expect(canvas.getByTestId('inbox-note')).toHaveValue('Three stations at most.');
    await userEvent.click(canvas.getByTestId('inbox-answer'));

    await expect(args.onAnswer).toHaveBeenCalledExactlyOnceWith({ option: 3, note: 'Three stations at most.' });
  },
};

export const ReadOnly: Story = { args: { isReadOnly: true } };
