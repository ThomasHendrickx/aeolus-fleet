import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { NOW, PING_TIMELINE, REVIEWER, TIMELINE } from './ship-page.fixtures';
import { ShipTimeline } from './ship-timeline';

const meta = {
  title: 'Organisms/ShipTimeline',
  component: ShipTimeline,
  args: { shipId: REVIEWER.id, entries: TIMELINE, state: 'ready', now: NOW, onOpenMessage: fn(), onRetry: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-140">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShipTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** A ping from argo, taken and answered with pong. */
export const Pinged: Story = { args: { entries: [...PING_TIMELINE, ...TIMELINE] } };
export const JustCommissioned: Story = { args: { entries: TIMELINE.slice(-1) } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = { args: { state: 'error' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
