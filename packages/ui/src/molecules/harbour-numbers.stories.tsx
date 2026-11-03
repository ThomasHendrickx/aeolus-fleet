import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { HarbourNumbers } from './harbour-numbers.js';

const meta = {
  title: 'Harbour/HarbourNumbers',
  component: HarbourNumbers,
  args: { counts: { ships: 19, alert: 1, awaitingCrew: 2, blocked: 1, working: 8, idle: 7 } },
} satisfies Meta<typeof HarbourNumbers>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Large, as on the console's page: Ships, then the five states, each word and icon in its tone; only Alert is filled. */
export const Wide: Story = {
  play: async ({ canvasElement }) => {
    const words = ['alert', 'awaitingCrew', 'blocked', 'working', 'idle'].map((state) => within(within(canvasElement).getByTestId(`harbour-number-${state}`)).getByTestId('ship-state'));
    await expect(words.map((word) => [word.textContent, word.dataset.tone])).toEqual([
      ['Alert', 'attention'],
      ['Awaiting crew', 'waiting'],
      ['Blocked', 'blocked'],
      ['Working', 'active'],
      ['Idle', 'none'],
    ]);
  },
  decorators: [
    (Story) => (
      <div className="w-284">
        <Story />
      </div>
    ),
  ],
};

/** Small, by its own width: a phone at 375. "Awaiting crew" wraps rather than being cut, and every word stays inside its card. */
export const Narrow: Story = {
  play: async ({ canvasElement }) => {
    const word = within(within(canvasElement).getByTestId('harbour-number-awaitingCrew')).getByTestId('ship-state');
    await expect(word.scrollWidth).toBeLessThanOrEqual(word.clientWidth);
    const outside = ['alert', 'awaitingCrew', 'blocked', 'working', 'idle'].filter((state) => {
      const card = within(canvasElement).getByTestId(`harbour-number-${state}`).getBoundingClientRect();
      const shown = within(within(canvasElement).getByTestId(`harbour-number-${state}`)).getByTestId('ship-state').getBoundingClientRect();
      return shown.left < card.left || shown.right > card.right;
    });
    await expect(outside).toEqual([]);
  },
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
  args: { counts: { ships: 1, alert: 0, awaitingCrew: 0, blocked: 0, working: 0, idle: 1 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('harbour-number-alert')).toHaveTextContent('0Alert');
    await expect(within(within(canvasElement).getByTestId('harbour-number-blocked')).getByTestId('ship-state')).toHaveClass('text-muted-foreground');
  },
};

/** While the fleet is read: the shape that is coming, the words already there. */
export const Loading: Story = { args: { counts: undefined } };

/** Light and dark side by side, wide and narrow, as the sheet draws the numbers. */
export const LightAndDark: Story = {
  render: (args) => (
    <div className="grid grid-cols-2">
      {(['', 'dark'] as const).map((mode) => (
        <div key={mode || 'light'} className={`${mode} grid gap-4 bg-background p-4 text-foreground`}>
          <HarbourNumbers {...args} />
          <div className="w-86">
            <HarbourNumbers {...args} />
          </div>
        </div>
      ))}
    </div>
  ),
};
