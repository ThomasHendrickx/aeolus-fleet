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
    onDraftChange: fn(),
    isPending: false,
    now: NOW,
  },
  decorators: [(Story) => <div className="flex h-160 flex-col">{Story()}</div>],
} satisfies Meta<typeof QuestionReader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Not answered: the asker's pick is preselected as a suggestion, with its why; Answer names it, and one tap sends it once. */
export const Open: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('inbox-question-status')).toHaveTextContent('Not answered');
    await expect(canvas.getByTestId('inbox-option-2')).toHaveAttribute('data-suggested', 'true');
    await expect(canvas.getByTestId('inbox-option-2')).toHaveTextContent('implementer-c’s pick, not sent');
    await expect(args.onDraftChange).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByTestId('inbox-answer'));

    await expect(args.onAnswer).toHaveBeenCalledTimes(1);
    await expect(args.onAnswer).toHaveBeenCalledWith({ option: 2 });
  },
};

/** An option with a note: one tap sends both, once. */
export const WithNote: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId('inbox-note'), 'Tell core first.');
    await userEvent.click(canvas.getByTestId('inbox-answer'));

    await expect(args.onAnswer).toHaveBeenCalledTimes(1);
    await expect(args.onAnswer).toHaveBeenCalledWith({ option: 2, note: 'Tell core first.' });
  },
};

/** Another option chosen: no longer a suggestion, and the choice is a draft until it is sent. */
export const OtherOption: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('30 days'));

    await expect(canvas.getByTestId('inbox-option-2')).not.toHaveAttribute('data-suggested');
    await expect(args.onDraftChange).toHaveBeenLastCalledWith({ option: 3, note: '' });
  },
};

/** Back on a question left with a draft: the choice and the note are as the operator left them. */
export const Draft: Story = {
  args: { draft: { option: 1, note: 'One week is enough.' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('inbox-note')).toHaveValue('One week is enough.');
    await expect(canvas.getByTestId('inbox-answer')).toHaveTextContent('Answer: 7 days, with note');
  },
};

/** The pick taken back with a second tap: the note goes alone, once. */
export const NoteAlone: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('14 days'));
    await userEvent.type(canvas.getByTestId('inbox-note'), 'Which stations?');
    await userEvent.click(canvas.getByTestId('inbox-answer'));

    await expect(args.onAnswer).toHaveBeenCalledTimes(1);
    await expect(args.onAnswer).toHaveBeenCalledWith({ note: 'Which stations?' });
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

    await expect(args.onAnswer).toHaveBeenCalledTimes(1);
    await expect(args.onAnswer).toHaveBeenCalledWith({ option: 3, note: 'Three stations at most.' });
  },
};

export const ReadOnly: Story = { args: { isReadOnly: true } };
