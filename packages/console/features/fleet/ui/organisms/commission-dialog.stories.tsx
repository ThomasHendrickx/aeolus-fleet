import type { ListedShip } from '@aeolus-fleet/common';
import { CORE_SCOPE_DESCRIPTIONS, createIdGenerator } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { CommissionDialog } from './commission-dialog';
import { MACHINE_LABELS, OFFERS } from '../../../../lib/fixtures/machines.fixtures';

const newId = createIdGenerator();

function aShip(name: string, type: string): ListedShip {
  return { id: newId('ship'), name, type, kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null, scopes: ['messages:send', 'messages:receive'], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null };
}

/** The fleet scopes as fleet.scopes describes them, the core ones' descriptions from common. */
const FLEET_ACCESS = {
  title: 'Fleet access',
  namespace: null,
  scopes: (['messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf'] as const).map((scope) => ({ scope, description: CORE_SCOPE_DESCRIPTIONS[scope] })),
};
const SQUADRONS_SCOPES = {
  title: 'squadrons',
  namespace: 'squadrons',
  scopes: [
    { scope: 'squadrons:form', description: 'Form a squadron by message' },
    { scope: 'squadrons:scale', description: 'Add and remove members of a squadron it formed' },
  ],
};

const meta = {
  title: 'Organisms/CommissionDialog',
  component: CommissionDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    activeShips: [aShip('reviewer-01', 'reviewer'), aShip('reviewer-02', 'reviewer'), aShip('planner', 'planner')],
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    scopeGroups: [FLEET_ACCESS],
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
/** Fleet access: each switch shows the description the fleet gives its scope (decision 0046). */
export const FleetAccess: Story = {
  play: async () => {
    const label = await screen.findByText(CORE_SCOPE_DESCRIPTIONS['fleet:read']);
    await waitFor(async () => {
      await expect(label).toBeVisible();
    });
  },
};
/** A plugin's scopes, under the name of the ship that declared them, each with its own description. */
export const WithPluginScopes: Story = {
  args: { scopeGroups: [FLEET_ACCESS, SQUADRONS_SCOPES] },
  play: async () => {
    await waitFor(async () => {
      await expect(screen.getByTestId('commission-scopes-squadrons')).toHaveTextContent('Form a squadron by message');
    });
  },
};
/** While the fleet's scopes are read: no switch yet. */
export const ReadingScopes: Story = { args: { scopeGroups: undefined } };
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
