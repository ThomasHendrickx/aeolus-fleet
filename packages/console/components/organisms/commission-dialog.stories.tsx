import type { ListedShip } from '@aeolus-fleet/common';
import { createIdGenerator } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CommissionDialog } from './commission-dialog';
import { OFFERS } from './machines.fixtures';

const newId = createIdGenerator();

function aShip(name: string, type: string): ListedShip {
  return { id: newId('ship'), name, type, kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null, scopes: ['messages:send', 'messages:receive'], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null };
}

const meta = {
  title: 'Organisms/CommissionDialog',
  component: CommissionDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    activeShips: [aShip('reviewer-01', 'reviewer'), aShip('reviewer-02', 'reviewer'), aShip('planner', 'planner')],
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    onSubmit: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="min-h-180">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommissionDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty: the rules under each field. Type a name to see available, taken or why not. */
export const Empty: Story = {};
export const Commissioning: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'An active ship is already named reviewer-01.' } };
/** At the fleet's ship limit (canvas 12.1): the dialog says so and commissions nothing. */
export const AtShipLimit: Story = { args: { shipLimit: 10, accountUrl: 'https://pagasae.aeolus-fleet.dev/account' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** With the trierarch plugin on: Request a crew carries the crew request's settings. */
export const WithTrierarchPlugin: Story = { args: { crewRequest: { offers: OFFERS, squadrons: ['hemma-feature-63p5sx'], onSettingsChange: () => undefined } } };
export const WithTrierarchPluginNoRoom: Story = { args: { crewRequest: { offers: OFFERS, check: { kind: 'noRoom', reason: 'no trierarch with room: all 1 that fit are full' }, onSettingsChange: () => undefined } } };
