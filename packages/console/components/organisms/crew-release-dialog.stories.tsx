import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ARGO, minutesAgo, PLANNER } from '../../lib/fixtures/ship-page.fixtures';
import { CrewReleaseDialog } from './crew-release-dialog';

const meta = {
  title: 'Organisms/CrewReleaseDialog',
  component: CrewReleaseDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    shipName: 'aeolus-fleet',
    stage: { kind: 'assigned', requestedAt: minutesAgo(90), trierarch: { ...PLANNER, name: 'trierarch-mac' }, status: 'running', attempt: 0, startedAt: minutesAgo(80) },
    inFlightCount: 1,
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    onConfirm: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="min-h-128">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CrewReleaseDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Assigned: Story = {};
export const CrewedByHand: Story = {
  args: { shipName: 'triage-bot', stage: { kind: 'crewedByHand', requestedAt: minutesAgo(45), crewedBy: ARGO, since: minutesAgo(20) }, sessionLocation: 'MacBook', inFlightCount: 0 },
};
export const Releasing: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'The server did not answer. Nothing changed.' } };
