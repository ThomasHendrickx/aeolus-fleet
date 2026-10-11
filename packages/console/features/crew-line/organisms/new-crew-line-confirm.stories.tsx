import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { NewCrewLineConfirm } from './new-crew-line-confirm';

const meta = {
  title: 'Organisms/NewCrewLineConfirm',
  component: NewCrewLineConfirm,
  args: { memberName: 'implementer-q8r2', isOpen: true, onOpenChange: () => undefined, onConfirm: () => undefined },
} satisfies Meta<typeof NewCrewLineConfirm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A member awaiting crew with no line out: the new line ends nothing. */
export const EndsNothing: Story = {};

export const EndsASession: Story = {
  args: { replacedText: 'This ends the session on mac mini. 1 in-flight delivery returns to pending. Nothing is lost.' },
};

export const EndsAnUnclaimedLine: Story = {
  args: { replacedText: 'The crew line issued earlier, not claimed yet, stops working.' },
};
