import { CORE_SCOPE_DESCRIPTIONS, idSchema } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import { CommissionDialog } from './commission-dialog';
import { MACHINE_LABELS, OFFERS } from '../../../../lib/fixtures/machines.fixtures';

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
    types: ['planner', 'reviewer'],
    taken: { names: ['reviewer-01', 'reviewer-02', 'planner'], typeShipCounts: new Map([['reviewer', 2], ['planner', 1], ['auditor', 0]]) },
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
/** Fleet access: each scope the picker lists shows the description the fleet gives it (decision 0046), and a picked one shows as a chip. */
export const FleetAccess: Story = {
  play: async () => {
    const fleet = await screen.findByTestId('commission-scopes-fleet');
    await userEvent.type(within(fleet).getByTestId('scope-picker-search'), 'fleet:read');
    const option = await screen.findByTestId('scope-picker-option');
    await expect(option).toHaveTextContent(CORE_SCOPE_DESCRIPTIONS['fleet:read']);
    await userEvent.click(option);
    await expect(within(fleet).getByTestId('scope-picker-chip')).toHaveTextContent('fleet:read');
  },
};
/** A plugin's scopes, in their own picker under the name of the ship that declared them, each with its own description. */
export const WithPluginScopes: Story = {
  args: { scopeGroups: [FLEET_ACCESS, SQUADRONS_SCOPES] },
  play: async () => {
    const squadrons = await screen.findByTestId('commission-scopes-squadrons');
    await userEvent.click(within(squadrons).getByTestId('scope-picker-search'));
    await expect(await screen.findByText('Form a squadron by message')).toBeVisible();
  },
};
/** While the fleet's scopes are read: no picker yet. */
export const ReadingScopes: Story = { args: { scopeGroups: undefined } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** With the trierarch plugin on: Request a crew carries the crew request's settings. */
export const WithTrierarchPlugin: Story = { args: { crewRequest: { offers: OFFERS, squadrons: ['hemma-feature-63p5sx'], machineLabels: MACHINE_LABELS, onSettingsChange: () => undefined } } };
/** An MCP server picked under Machine labels, from what the machines offer for the harness. */
export const WithMcpServer: Story = {
  args: WithTrierarchPlugin.args,
  play: async () => {
    await userEvent.click(await screen.findByTestId('mcp-servers-add'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'company-graph' }));
    await expect(await screen.findByTestId('mcp-server')).toHaveTextContent('company-graph');
    // The menu hands focus back to Add server; the approved mockup has it on Name.
    screen.getByTestId('commission-name').focus();
  },
};
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

/** The fleet's person ships, as argo picks an owner from them (docs/design/ship-owners). */
const CHARLOTTE = idSchema('ship').parse('shp_01j9k2t4qzr3a9w6m2v5n7ch01');
const PERSON_SHIPS = [
  { id: idSchema('ship').parse('shp_01j9k2t4qzr3a9w6m2v5n7bk01'), name: 'burak' },
  { id: CHARLOTTE, name: 'charlotte' },
  { id: idSchema('ship').parse('shp_01j9k2t4qzr3a9w6m2v5n7th01'), name: 'thomas' },
];

/** Types a free name and a type, as the boards show them. */
async function typeNameAndType() {
  await userEvent.type(await screen.findByTestId('commission-name'), 'reviewer-03');
  const type = screen.getByTestId('commission-type');
  await userEvent.type(type.querySelector('input') ?? type, 'reviewer');
  await userEvent.keyboard('{Escape}');
}

/** Signed in as argo, nothing picked yet: Commission ship stays off until an owner is picked. */
export const OwnerNothingPicked: Story = {
  args: { owner: { choices: PERSON_SHIPS } },
  play: async () => {
    await typeNameAndType();
    await expect(screen.getByTestId('commission-submit')).toBeDisabled();
    await expect(screen.getByText('The person who answers for reviewer-03: its questions, gates and trouble go to their ship.')).toBeVisible();
  },
};
/** Signed in as argo, the owner argo named last preselected: Commission ship commissions it with that owner. */
export const OwnerLastPicked: Story = {
  args: { owner: { choices: PERSON_SHIPS, lastPicked: CHARLOTTE }, onSubmit: fn() },
  play: async ({ args }) => {
    await typeNameAndType();
    const owner = screen.getByTestId('commission-owner');
    await expect(owner.querySelector('input') ?? owner).toHaveValue('charlotte');
    await userEvent.click(screen.getByTestId('commission-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'reviewer-03', type: 'reviewer', owner: CHARLOTTE }, undefined);
  },
};
/** Picking an owner: person ships only, argo is not offered. */
export const OwnerPicking: Story = {
  args: { owner: { choices: PERSON_SHIPS } },
  play: async () => {
    await typeNameAndType();
    const owner = screen.getByTestId('commission-owner');
    await userEvent.type(owner.querySelector('input') ?? owner, 'r');
    const listed = await screen.findAllByRole('option');
    await expect(listed.map((option) => option.textContent)).toEqual(['burak', 'charlotte']);
    await expect(screen.queryByRole('option', { name: 'argo' })).toBeNull();
  },
};
/** No person ship in the fleet (S1): the field says so, and Commission ship stays off. */
export const OwnerNoPersonShip: Story = {
  args: { owner: { choices: [] } },
  play: async () => {
    await typeNameAndType();
    await expect(screen.getByText("A ship needs a person to answer for it. Commission that person's ship first.")).toBeVisible();
    await expect(screen.getByTestId('commission-submit')).toBeDisabled();
  },
};
/** Refused by the fleet: the reason names the field, the input kept. */
export const OwnerRefused: Story = {
  args: { owner: { choices: PERSON_SHIPS, lastPicked: CHARLOTTE }, error: 'owner: name the person ship that owns the new ship' },
  play: typeNameAndType,
};
/** Signed in as an account: no Owner field, as before; the account's person ship owns the ship. */
export const SignedInAsAccount: Story = {
  play: async () => {
    await typeNameAndType();
    await expect(screen.queryByTestId('commission-owner')).toBeNull();
    await expect(screen.getByTestId('commission-submit')).toBeEnabled();
  },
};
