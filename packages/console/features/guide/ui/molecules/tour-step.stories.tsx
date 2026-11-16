import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, within, userEvent } from 'storybook/test';

import { TourStep, type TourStepProps } from './tour-step';

const meta = {
  title: 'Molecules/TourStep',
  component: TourStep,
  args: {
    title: 'Your fleet',
    text: 'Every ship in the fleet, its type and who crews it. A ship acknowledges each message it receives.',
    index: 0,
    total: 6,
    anchor: null,
    side: 'bottom',
    onBack: fn(),
    onNext: fn(),
    onSkip: fn(),
    onFinish: fn(),
  },
} satisfies Meta<typeof TourStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Its anchor is not on the page: centred, pointing at nothing, so "1 of 6" stays. */
export const Centred: Story = {};

/** A middle step: Skip, Back and Next. */
export const MiddleStep: Story = { args: { index: 2, title: 'A message and its delivery', text: 'Each send is stored before it returns OK, then delivered to the ship.' } };

/** The last step: Back and Finish, no Skip. */
export const LastStep: Story = { args: { index: 5, title: 'Sign up', text: 'Run your own fleet: the first ships are free.' } };

function Anchored(args: TourStepProps) {
  const [anchor, setAnchor] = useState<Element | null>(null);
  return (
    <div className="p-10 pt-60">
      <div ref={setAnchor} className="inline-block rounded-lg border border-border bg-card px-4 py-3 text-body">
        The fleet table
      </div>
      {anchor === null ? null : <TourStep {...args} anchor={anchor} />}
    </div>
  );
}

/** Pointing at its anchor, below it. */
export const PointingAtItsAnchor: Story = { render: (args) => <Anchored {...args} /> };

/** On a narrow window: above its anchor, so what follows the anchor stays in sight. */
export const AboveItsAnchor: Story = { args: { side: 'top' }, render: (args) => <Anchored {...args} /> };

/** The final demo step offers hosted sign-up and self-hosting without hiding navigation. */
export const LastStepWithActions: Story = {
  args: {
    index: 5,
    title: 'Start your own fleet',
    text: 'Sign up for a hosted fleet, or run Aeolus yourself: it is open source. Crew your ships from Claude Code, Codex or any other harness, by hand or on your own machines.',
    actions: [
      { label: 'Sign up', href: 'https://account.aeolus-fleet.dev/sign-in' },
      { label: 'GitHub', href: 'https://github.com/ThomasHendrickx/aeolus-fleet' },
    ],
  },
  play: async ({ canvasElement, args }) => {
    // Given the last step configured with the approved actions.
    const canvas = within(canvasElement);

    // When the step is rendered.
    const signUp = canvas.getByRole('link', { name: 'Sign up' });
    const github = canvas.getByRole('link', { name: 'GitHub' });

    // Then both destinations and the existing navigation are available.
    await expect(signUp).toHaveAttribute('href', 'https://account.aeolus-fleet.dev/sign-in');
    await expect(github).toHaveAttribute('href', 'https://github.com/ThomasHendrickx/aeolus-fleet');
    await expect(canvas.getByRole('button', { name: 'Back' })).toBeVisible();
    const finish = canvas.getByRole('button', { name: 'Finish' });
    await expect(finish).toBeVisible();
    await expect(getComputedStyle(canvas.getByTestId('tour-step-actions')).flexDirection).toBe('column');
    await expect(signUp).toHaveClass('bg-primary');
    await expect(github).toHaveClass('bg-card');
    await expect(finish).toHaveClass('bg-card');
    await expect(canvas.getByRole('button', { name: 'Back' })).toHaveClass('bg-card');
    await userEvent.click(finish);
    await expect(args.onFinish).toHaveBeenCalledOnce();
  },
};
