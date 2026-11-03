import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { SHIP_STATE_LOOKS, ShipState } from './ship-state.js';

const meta = {
  title: 'Ships/ShipState',
  component: ShipState,
  args: { state: 'working' },
} satisfies Meta<typeof ShipState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every state's mark carries its icon and its word, so it never rests on colour alone. */
async function expectMark(canvasElement: HTMLElement, word: string, tone: string | null) {
  const mark = within(canvasElement).getByTestId('ship-state');
  await expect(mark).toHaveTextContent(word);
  await expect(mark.querySelector('svg')).not.toBeNull();
  await expect(mark).toHaveAttribute('data-tone', tone ?? 'none');
}

/** Something is wrong: act now. Coral. */
export const Alert: Story = {
  args: { state: 'alert' },
  play: async ({ canvasElement }) => expectMark(canvasElement, 'Alert', 'attention'),
};

/** No session holds the lease: waits on a person. Amber. */
export const AwaitingCrew: Story = {
  args: { state: 'awaitingCrew' },
  play: async ({ canvasElement }) => expectMark(canvasElement, 'Awaiting crew', 'waiting'),
};

/** The crew says it cannot go on. Violet. */
export const Blocked: Story = {
  args: { state: 'blocked' },
  play: async ({ canvasElement }) => expectMark(canvasElement, 'Blocked', 'blocked'),
};

/** Live and in motion. Sea. */
export const Working: Story = {
  args: { state: 'working' },
  play: async ({ canvasElement }) => expectMark(canvasElement, 'Working', 'active'),
};

/** Nothing going on: no tone, the muted foreground. */
export const Idle: Story = {
  args: { state: 'idle' },
  play: async ({ canvasElement }) => expectMark(canvasElement, 'Idle', null),
};

/** The status beside the state: settled and well. Green. */
export const Crewed: Story = {
  args: { state: 'crewed' },
  play: async ({ canvasElement }) => expectMark(canvasElement, 'Crewed', 'ok'),
};

/** The status beside the state: over for good. Grey. */
export const Retired: Story = {
  args: { state: 'retired' },
  play: async ({ canvasElement }) => expectMark(canvasElement, 'Retired', 'ended'),
};

/** As a badge, filled in its tone: the Alert badge after a ship's status in the console's list and on its page. */
export const AlertBadge: Story = {
  args: { state: 'alert', isBadge: true },
  play: async ({ canvasElement }) => {
    await expectMark(canvasElement, 'Alert', 'attention');
    await expect(within(canvasElement).getByTestId('ship-state')).toHaveClass('rounded-full');
  },
};

/** Every state and status, plain and as a badge, at the meta and caption sizes: the sheet's proposed column in one place. */
export const All: Story = {
  render: () => (
    <div className="grid gap-3">
      {(['meta', 'caption'] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-4">
          {SHIP_STATE_LOOKS.map(({ state }) => (
            <ShipState key={state} state={state} size={size} />
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-4">
        {SHIP_STATE_LOOKS.map(({ state }) => (
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
            {SHIP_STATE_LOOKS.map(({ state }) => (
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
