import type { ListedShip } from '@aeolus-fleet/common';
import { createIdGenerator } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { CommissionDialog } from './commission-dialog';
import { MACHINE_LABELS, OFFERS } from '../../../lib/fixtures/machines.fixtures';

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
export const WithTrierarchPlugin: Story = { args: { crewRequest: { offers: OFFERS, squadrons: ['hemma-feature-63p5sx'], machineLabels: MACHINE_LABELS, onSettingsChange: () => undefined } } };
export const WithTrierarchPluginNoRoom: Story = { args: { crewRequest: { offers: OFFERS, check: { kind: 'noRoom', reason: 'no trierarch with room: all 1 that fit are full' }, onSettingsChange: () => undefined } } };
/** A machine label no machine carries, picked while commissioning: the request still goes, and waits for such a machine (#357). */
export const WithMachineLabelNoMachineCarries: Story = {
  args: WithTrierarchPlugin.args,
  play: async () => {
    await userEvent.click(await screen.findByTestId('machine-labels-add'));
    await userEvent.click(await screen.findByRole('button', { name: /^os/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^linux/ }));
    await waitFor(async () => {
      await expect(screen.getByTestId('commission-crew-note')).toHaveTextContent('The request will wait for a machine with these labels.');
    });
  },
};
