import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { HEALTH_NOW, STUCK_HEALTH } from '../../../../lib/fixtures/health.fixtures';
import { causeGroupsOf, type CauseGroup } from '../../services/health-view';
import { CauseCard } from './cause-card';

function groupOf(cause: CauseGroup['cause']): CauseGroup {
  const group = causeGroupsOf(STUCK_HEALTH).find((each) => each.cause === cause);
  if (!group) {
    throw new Error(`No ${cause} in the fixture`);
  }
  return group;
}

const meta = {
  title: 'Organisms/CauseCard',
  component: CauseCard,
  args: { group: groupOf('stalledInFlight'), notes: new Map(), now: HEALTH_NOW },
  decorators: [(Story) => <div className="max-w-2xl">{Story()}</div>],
} satisfies Meta<typeof CauseCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two ships stalled: one opens its machine, the other its ship page. */
export const StalledInFlight: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByTestId('health-next-step').map((step) => step.textContent)).toEqual(['Open ship', 'Open machine']);
  },
};

/** A type no ship can take: the type as a chip, Commission as its step. */
export const NoShipCanTake: Story = { args: { group: groupOf('noShipCanTake') } };

export const WaitingForCrew: Story = { args: { group: groupOf('waitingForCrew') } };

export const Undeliverable: Story = { args: { group: groupOf('undeliverable') } };

export const Dark: Story = { globals: { theme: 'dark' } };

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
