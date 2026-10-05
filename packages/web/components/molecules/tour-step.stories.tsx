import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

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
    <div className="p-10">
      <div ref={setAnchor} className="inline-block rounded-lg border border-border bg-card px-4 py-3 text-body">
        The fleet table
      </div>
      {anchor === null ? null : <TourStep {...args} anchor={anchor} />}
    </div>
  );
}

/** Pointing at its anchor, below it. */
export const PointingAtItsAnchor: Story = { render: (args) => <Anchored {...args} /> };
