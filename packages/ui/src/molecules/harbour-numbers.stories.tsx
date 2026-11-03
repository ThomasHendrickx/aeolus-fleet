import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { HarbourNumbers } from './harbour-numbers.js';

const meta = {
  title: 'Harbour/HarbourNumbers',
  component: HarbourNumbers,
  args: { counts: { ships: 19, alert: 1, waiting: 3, working: 8, idle: 7 } },
} satisfies Meta<typeof HarbourNumbers>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Large, as on the console's page: only Alert is filled in its tone. */
export const Wide: Story = {
  decorators: [
    (Story) => (
      <div className="w-284">
        <Story />
      </div>
    ),
  ],
};

/** Small, by its own width: a phone, or Bridge's column at 1440. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-86">
        <Story />
      </div>
    ),
  ],
};

/** A number at 0 carries no tone: zero does not ask for attention. */
export const Zeros: Story = {
  args: { counts: { ships: 1, alert: 0, waiting: 0, working: 0, idle: 1 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('harbour-number-alert')).toHaveTextContent('0Alert');
  },
};

/** While the fleet is read: the shape that is coming, the words already there. */
export const Loading: Story = { args: { counts: undefined } };
