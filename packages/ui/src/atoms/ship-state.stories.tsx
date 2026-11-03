import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { SHIP_STATES, ShipState } from './ship-state.js';

const meta = {
  title: 'Ships/ShipState',
  component: ShipState,
  args: { state: 'working' },
} satisfies Meta<typeof ShipState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every state's mark carries its icon and its word, so it never rests on colour alone. */
async function expectMark(canvasElement: HTMLElement, { word, tone }: { word: string; tone: string | null }) {
  const mark = within(canvasElement).getByTestId('ship-state');
  await expect(mark).toHaveTextContent(word);
  await expect(mark.querySelector('svg')).not.toBeNull();
  await expect(mark).toHaveAttribute('data-tone', tone ?? 'none');
}

/** The sheet's measures (sheet.html, .st and .badge): the mark's height and the gap from icon to word. */
async function expectDrawn(mark: HTMLElement, { height, gap }: { height: number; gap: string }) {
  await expect(mark.getBoundingClientRect().height).toBe(height);
  await expect(getComputedStyle(mark).columnGap).toBe(gap);
}

/** Something is wrong: act now. Coral. */
export const Alert: Story = {
  args: { state: 'alert' },
  play: async ({ canvasElement }) => expectMark(canvasElement, { word: 'Alert', tone: 'attention' }),
};

/** No session holds the lease: waits on a person. Amber. */
export const AwaitingCrew: Story = {
  args: { state: 'awaitingCrew' },
  play: async ({ canvasElement }) => expectMark(canvasElement, { word: 'Awaiting crew', tone: 'waiting' }),
};

/** The crew says it cannot go on. Violet. */
export const Blocked: Story = {
  args: { state: 'blocked' },
  play: async ({ canvasElement }) => expectMark(canvasElement, { word: 'Blocked', tone: 'blocked' }),
};

/** Live and in motion. Sea. */
export const Working: Story = {
  args: { state: 'working' },
  play: async ({ canvasElement }) => expectMark(canvasElement, { word: 'Working', tone: 'active' }),
};

/** Nothing going on: no tone, the muted foreground. */
export const Idle: Story = {
  args: { state: 'idle' },
  play: async ({ canvasElement }) => expectMark(canvasElement, { word: 'Idle', tone: null }),
};

/** The status beside the state: settled and well. Green. */
export const Crewed: Story = {
  args: { state: 'crewed' },
  play: async ({ canvasElement }) => expectMark(canvasElement, { word: 'Crewed', tone: 'ok' }),
};

/** The status beside the state: over for good. Grey. */
export const Retired: Story = {
  args: { state: 'retired' },
  play: async ({ canvasElement }) => expectMark(canvasElement, { word: 'Retired', tone: 'ended' }),
};

/** As a badge, filled in its tone: the Alert badge after a ship's status in the console's list and on its page. */
export const AlertBadge: Story = {
  args: { state: 'alert', isBadge: true },
  play: async ({ canvasElement }) => {
    await expectMark(canvasElement, { word: 'Alert', tone: 'attention' });
    const badge = within(canvasElement).getByTestId('ship-state');
    await expect(badge).toHaveClass('rounded-full');
    await expectDrawn(badge, { height: 21, gap: '5px' });
  },
};

/** At caption size, on a tile or a number, the word is 12 px in a line 17 px tall, as the sheet draws it. */
export const Caption: Story = {
  args: { state: 'awaitingCrew', size: 'caption' },
  play: async ({ canvasElement }) => {
    await expectMark(canvasElement, { word: 'Awaiting crew', tone: 'waiting' });
    await expectDrawn(within(canvasElement).getByTestId('ship-state'), { height: 17, gap: '5px' });
  },
};

/** At meta size, in a list or on a page, the word is 13 px in a line 18 px tall, as the sheet draws it. */
export const Meta: Story = {
  args: { state: 'blocked', size: 'meta' },
  play: async ({ canvasElement }) => {
    await expectMark(canvasElement, { word: 'Blocked', tone: 'blocked' });
    await expectDrawn(within(canvasElement).getByTestId('ship-state'), { height: 18, gap: '5px' });
  },
};

/** Every state and status, plain and as a badge, at the meta and caption sizes: the sheet's proposed column in one place. */
export const All: Story = {
  render: () => (
    <div className="grid gap-3">
      {(['meta', 'caption'] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-4">
          {SHIP_STATES.map((state) => (
            <ShipState key={state} state={state} size={size} />
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-4">
        {SHIP_STATES.map((state) => (
          <ShipState key={state} state={state} isBadge />
        ))}
      </div>
    </div>
  ),
};

/** Light and dark side by side, as the sheet draws both. */
export const LightAndDark: Story = {
  render: () => (
    <div className="grid grid-cols-2">
      {(['', 'dark'] as const).map((mode) => (
        <div key={mode || 'light'} className={`${mode} grid gap-3 bg-background p-4 text-foreground`}>
          <div className="flex flex-wrap items-center gap-4">
            {SHIP_STATES.map((state) => (
              <ShipState key={state} state={state} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShipState state="crewed" />
            <ShipState state="alert" isBadge />
          </div>
        </div>
      ))}
    </div>
  ),
};
