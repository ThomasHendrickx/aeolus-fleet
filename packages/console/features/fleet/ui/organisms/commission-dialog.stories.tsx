import { CORE_SCOPE_DESCRIPTIONS, idSchema } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useEffect, useState, type ComponentProps } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

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
    onSubmit: (): void | Promise<void> => undefined,
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
    await userEvent.click(await screen.findByTestId('commission-extra-permissions'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Find a permission' }), 'fleet:read');
    await expect(screen.getByTestId('permissions-choices')).toHaveTextContent(CORE_SCOPE_DESCRIPTIONS['fleet:read']);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Read the fleet/ }));
    await expect(screen.getByText('1 selected')).toBeVisible();
  },
};
/** A plugin's scopes, in their own picker under the name of the ship that declared them, each with its own description. */
export const WithPluginScopes: Story = {
  args: { scopeGroups: [FLEET_ACCESS, SQUADRONS_SCOPES] },
  play: async () => {
    await userEvent.click(await screen.findByTestId('commission-extra-permissions'));
    await expect(screen.getByTestId('permissions-choices')).toHaveTextContent('Form a squadron by message');
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
    await expect(screen.getByText('Its questions, gates and trouble go to this person’s ship.')).toBeVisible();
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
/** The person ships could not be read: the field says what failed, keeps the input and offers Try again. */
export const OwnerReadFailed: Story = {
  args: { owner: { choices: undefined, failure: { message: 'Network request failed', onRetry: fn() } } },
  play: async ({ args }) => {
    await typeNameAndType();
    await expect(screen.getByText('Couldn’t read the person ships')).toBeVisible();
    await expect(screen.getByTestId('commission-name')).toHaveValue('reviewer-03');
    await expect(screen.getByTestId('commission-submit')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await expect(args.owner?.failure?.onRetry).toHaveBeenCalled();
  },
};
/** The owner argo named last could not be read: no preselection, and the field says so with Try again. */
export const OwnerLastNamedReadFailed: Story = {
  args: { owner: { choices: PERSON_SHIPS, failure: { message: 'Network request failed', onRetry: fn() } } },
  play: async () => {
    await typeNameAndType();
    await expect(screen.getByText('Couldn’t read the person ships')).toBeVisible();
    await expect(screen.getByRole('button', { name: /try again/i })).toBeVisible();
  },
};
/** Signed in as an account: no Owner field, as before; the account's person ship owns the ship. */
export const SignedInAsAccount: Story = {
  play: async () => {
    await typeNameAndType();
    await expect(screen.queryByTestId('commission-owner')).toBeNull();
    await expect(screen.getByTestId('commission-submit')).toBeEnabled();
  },
};

function CommissionWithDelayedOffers(args: ComponentProps<typeof CommissionDialog>) {
  const [offers, setOffers] = useState<typeof OFFERS>([]);
  useEffect(() => {
    const deliverOffers = () => { setOffers(OFFERS); };
    window.addEventListener('deliver-offers', deliverOffers);
    return () => { window.removeEventListener('deliver-offers', deliverOffers); };
  }, []);
  return <CommissionDialog {...args} crewRequest={{ offers, onSettingsChange: () => undefined }} />;
}

/** Options arrive after the commission dialog opens (#1720). */
export const OffersArriveAfterOpening: Story = {
  args: { onSubmit: fn() },
  render: (args) => <CommissionWithDelayedOffers {...args} />,
  play: async ({ args }) => {
    await typeNameAndType();
    window.dispatchEvent(new Event('deliver-offers'));
    await waitFor(async () => {
      await expect(screen.getByTestId('crew-settings-harness')).toHaveTextContent('Claude Code');
      await expect(screen.getByTestId('crew-settings-workspace')).toHaveTextContent('aeolus-fleet');
      await expect(screen.getByTestId('commission-submit')).toBeEnabled();
    });
    await userEvent.click(screen.getByTestId('commission-submit'));
    await expect(args.onSubmit).toHaveBeenCalledOnce();
  },
};

/** An edited first prompt is kept when the options arrive (#1720). */
export const EditedBeforeOffersArrive: Story = {
  render: (args) => <CommissionWithDelayedOffers {...args} />,
  play: async () => {
    await userEvent.click(await screen.findByTestId('commission-request-crew'));
    await userEvent.type(await screen.findByTestId('crew-settings-first-prompt'), 'Triage issues');
    window.dispatchEvent(new Event('deliver-offers'));
    await waitFor(async () => {
      await expect(screen.getByTestId('crew-settings-harness')).toHaveTextContent('Claude Code');
      await expect(screen.getByTestId('crew-settings-workspace')).toHaveTextContent('aeolus-fleet');
    }, { timeout: 4000 });
    await expect(screen.getByTestId('crew-settings-first-prompt')).toHaveValue('Triage issues');
  },
};

/** Approved first state: no computer can crew, and extras stay out of the way. */
export const NoComputerCanCrew: Story = {
  args: { crewRequest: { offers: [], onSettingsChange: () => undefined } },
  play: async () => {
    // Given a connected plugin without an offered harness.
    const crew = await screen.findByTestId('commission-request-crew');
    // When the form opens.
    await expect(crew).not.toBeChecked();
    await expect(screen.queryByRole('textbox', { name: 'Find a permission' })).toBeNull();
    // Then it explains both the default and what prevents commission.
    await waitFor(async () => { await expect(screen.getByText('No computer can crew this ship right now. You get the starting prompt next. You can still request a crew.')).toBeVisible(); });
    await expect(screen.getByTestId('commission-disabled-reason')).toHaveTextContent('Enter a name and type.');
    await userEvent.click(crew);
    await expect(crew).toBeChecked();
    await expect(screen.getByTestId('crew-settings-harness')).toBeVisible();
  },
};

/** Each extra is one permission, with plain words and its scope beside it. */
export const ExtraPermissions: Story = {
  args: { scopeGroups: [FLEET_ACCESS, SQUADRONS_SCOPES], onSubmit: fn() },
  play: async ({ args }) => {
    // Given a ship that needs one extra permission.
    await typeNameAndType();
    // When its commissioner opens and searches the extras.
    await userEvent.click(screen.getByText('Extra permissions'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Find a permission' }), 'Read the fleet');
    await userEvent.click(screen.getByRole('checkbox', { name: /Read the fleet/ }));
    // Then exactly that permission is granted.
    await expect(screen.getByText('1 selected')).toBeVisible();
    await userEvent.click(screen.getByTestId('commission-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'reviewer-03', type: 'reviewer', scopes: ['fleet:read'] }, undefined);
  },
};

/** The footer names every missing requirement, alongside the field hints. */
export const DisabledReason: Story = {
  args: { owner: { choices: [] }, crewRequest: { offers: [], onSettingsChange: () => undefined } },
  play: async () => {
    // Given a name and type but no owner or computer.
    await typeNameAndType();
    // When a crew is requested anyway.
    await userEvent.click(screen.getByTestId('commission-request-crew'));
    // Then the button's reason says what to complete and how.
    await expect(screen.getByTestId('commission-disabled-reason')).toHaveTextContent('Pick an owner and complete crew settings.');
    await expect(screen.getByTestId('commission-disabled-reason')).toHaveTextContent('Commission the person’s ship first.');
    await expect(screen.getByTestId('commission-submit')).toBeDisabled();
  },
};

/** The approved first state with argo's last owner, in either theme. */
export const ApprovedFirstState: Story = { args: { owner: { choices: PERSON_SHIPS, lastPicked: PERSON_SHIPS.find((person) => person.name === 'thomas')?.id }, crewRequest: { offers: [], onSettingsChange: () => undefined }, scopeGroups: [{ title: 'Core', namespace: null, scopes: [{ scope: 'meetings:open', description: 'Invite ships to a meeting.' }, { scope: 'fleet:read', description: 'Read ships, timelines and messages.' }] }, SQUADRONS_SCOPES, { title: 'CRM', namespace: 'crm', scopes: [{ scope: 'crm:read-leads', description: 'Read leads in the CRM.' }] }] } };
export const ApprovedExtras: Story = {
  args: ApprovedFirstState.args,
  play: async () => {
    await typeNameAndType();
    await userEvent.click(screen.getByTestId('commission-extra-permissions'));
    await userEvent.click(screen.getByRole('checkbox', { name: /Open a meeting/ }));
  },
};

/** The crew check is part of submit: pending starts before its answer, and a failure keeps the form. */
export const PendingCrewCheck: Story = {
  args: { onSubmit: () => new Promise<void>((_resolve, reject) => {
    window.addEventListener('refuse-commission-check', () => { reject(new Error('Couldn’t check crew settings. Nothing was commissioned. Try again.')); }, { once: true });
  }) },
  play: async () => {
    // Given a valid form awaiting a crew check.
    await typeNameAndType();
    // When it is submitted, before any server answer.
    await userEvent.click(screen.getByTestId('commission-submit'));
    // Then it is busy immediately, and a failed check is visible with inputs kept.
    await expect(screen.getByTestId('commission-submit')).toHaveAttribute('data-loading');
    window.dispatchEvent(new Event('refuse-commission-check'));
    await expect(await screen.findByText('Couldn’t check crew settings. Nothing was commissioned. Try again.')).toBeVisible();
    await expect(screen.getByTestId('commission-name')).toHaveValue('reviewer-03');
  },
};

/** The approved disabled state still shows a workspace and repository without an offered harness. */
export const NoHarnessOffered: Story = {
  args: NoComputerCanCrew.args,
  play: async () => {
    // Given no computer offers a harness.
    await userEvent.click(await screen.findByTestId('commission-request-crew'));
    // When the request is on.
    // Then the fields explain the empty choices and keep the repository visible.
    await expect(screen.getByTestId('crew-settings-harness')).toHaveTextContent('No harness offered');
    await expect(screen.getByTestId('crew-settings-workspace-kind')).toHaveTextContent('Repository');
    await expect(screen.getByTestId('crew-settings-workspace')).toHaveTextContent('Choose...');
    await expect(screen.getByText('Connect a computer that offers a harness, or turn off Request a crew.')).toBeVisible();
  },
};

/** With computers full, requesting a crew stays available but starts off. */
export const NoComputerWithRoom: Story = {
  args: WithTrierarchPluginNoRoom.args,
  play: async () => {
    await expect(await screen.findByTestId('commission-request-crew')).not.toBeChecked();
    await userEvent.click(screen.getByTestId('commission-request-crew'));
    await expect(screen.getByTestId('commission-request-crew')).toBeChecked();
  },
};

/** The phone form keeps its action full width and pinned above the bottom edge. */
export const PhoneActions: Story = {
  args: ApprovedFirstState.args,
  play: async () => {
    if (!('__vitest_browser__' in window)) return;
    const { page } = await import('vitest/browser');
    const initial = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(375, 1000);
    try {
      const submit = await screen.findByTestId('commission-submit');
      const footer = submit.closest('[data-slot="dialog-footer"]');
      await expect(submit.getBoundingClientRect().width).toBeGreaterThan(300);
      await waitFor(async () => { await expect(footer?.getBoundingClientRect().bottom).toBeGreaterThan(950); });
    } finally {
      await page.viewport(initial.width, initial.height);
    }
  },
};

/** The approved field hints describe type addressing and who receives the ship's questions. */
export const ApprovedFieldHints: Story = {
  args: ApprovedFirstState.args,
  play: async () => {
    // Given the first commission state.
    await waitFor(async () => { await expect(await screen.findByText('Ships of the same type share a type address.')).toBeVisible(); });
    await expect(screen.getByText('Its questions, gates and trouble go to this person’s ship.')).toBeVisible();
    await expect(screen.getByTestId('commission-disabled-reason')).toHaveTextContent('Complete the two fields above to commission this ship.');
    // When an existing type is entered.
    await typeNameAndType();
    // Then its count describes the active ships of that type.
    await expect(screen.getByText('2 active ships have this type.')).toBeVisible();
  },
};

/** A failed permission read keeps the form and offers a visible retry. */
export const PermissionsReadFailed: Story = {
  args: { scopeGroups: undefined, scopeFailure: { message: 'Network request failed. Nothing you typed is lost.', onRetry: fn() } },
  play: async ({ args }) => {
    await typeNameAndType();
    await userEvent.click(screen.getByTestId('commission-extra-permissions'));
    await expect(await screen.findByText('Couldn’t read permissions')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await expect(args.scopeFailure?.onRetry).toHaveBeenCalledOnce();
    await expect(screen.getByTestId('commission-name')).toHaveValue('reviewer-03');
  },
};
