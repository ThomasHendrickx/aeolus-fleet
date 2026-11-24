import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState, type ComponentProps } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import type { MemberDraft } from '../../../../lib/forming-members';
import { blueprintChoices } from '../../../../lib/squadrons-view';
import { blueprints, templates } from '../../../../lib/fixtures/squadrons.fixtures';
import { FormSquadronDialog, type FormCrew } from './form-squadron-dialog';
import { MACHINE_CONTEXT, MACHINE_LABELS, OFFERS } from '../../../../lib/fixtures/machines.fixtures';

const meta = {
  title: 'Organisms/FormSquadronDialog',
  component: FormSquadronDialog,
  args: {
    blueprints: blueprintChoices({ blueprints }),
    templates,
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    onSubmit: () => undefined,
  },
} satisfies Meta<typeof FormSquadronDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PickBlueprint: Story = {};
export const Forming: Story = { args: { isPending: true } };
export const FormingFailed: Story = { args: { error: 'The squadron manager did not answer. Nothing was commissioned.' } };

/** Members as squadrons merges them from their files (#343, S4): the planner's area left for the form, one implementer without a workspace. */
const DRAFTS: MemberDraft[] = [
  {
    slot: 'planner-1',
    role: 'planner',
    template: { repository: 'github.com/tidewater-labs/squadron-templates', name: 'planner', version: 4 },
    crew: { harness: 'claude-code', workspace: { kind: 'repositories', main: { repository: 'aeolus-fleet' }, subRepositories: [] }, options: { model: 'claude-opus-5-5' }, mcpServers: ['company-graph'] },
    parameters: [{ name: 'area', description: 'The part the features touch, such as the tide tables', value: null }],
  },
  {
    slot: 'implementer-1',
    role: 'implementer',
    template: { repository: 'github.com/tidewater-labs/squadron-templates', name: 'implementer', version: 2 },
    crew: { harness: 'claude-code', workspace: { kind: 'repositories', main: { repository: 'aeolus-fleet' }, subRepositories: [] }, options: { model: 'claude-opus-5-5', effort: 'high' }, machineLabels: [{ key: 'os', value: 'macos' }] },
    parameters: [],
  },
  {
    slot: 'implementer-2',
    role: 'implementer',
    template: { repository: 'github.com/tidewater-labs/squadron-templates', name: 'implementer', version: 2 },
    crew: { harness: 'claude-code', options: { model: 'claude-opus-5-5', effort: 'high' }, machineLabels: [{ key: 'os', value: 'macos' }, { key: 'site', value: 'home' }] },
    parameters: [],
  },
];

const CREW: FormCrew = { state: 'ready', members: DRAFTS, offers: OFFERS, context: MACHINE_CONTEXT, machineLabels: MACHINE_LABELS, onRetry: () => undefined };

/** Opens step 2, where the members are. */
async function toMembers({ canvasElement }: { canvasElement: HTMLElement }) {
  await userEvent.click(await within(canvasElement.ownerDocument.body).findByTestId('form-squadron-preview'));
}

/** Step 2 with the trierarch plugin: a section per member, the incomplete ones open, n of m ready, and Form squadron waiting (#343). */
export const Members: Story = { args: { crew: CREW }, play: toMembers };
/** Every member has what it needs: the sections fold and Form squadron is on: the quick accept. */
export const MembersAllReady: Story = {
  args: {
    crew: {
      ...CREW,
      members: DRAFTS.map((draft) => ({
        ...draft,
        crew: { ...draft.crew, workspace: { kind: 'repositories' as const, main: { repository: 'aeolus-fleet' }, subRepositories: [] }, machineLabels: [{ key: 'os', value: 'macos' }] },
        parameters: draft.parameters.map((parameter) => ({ ...parameter, value: 'tide tables' })),
      })),
    },
  },
  play: toMembers,
};
/** The members' crew settings are still being read. */
export const MembersLoading: Story = { args: { crew: { ...CREW, state: 'loading', members: [] } }, play: toMembers };
/** They could not be read: try again. */
export const MembersFailed: Story = { args: { crew: { ...CREW, state: 'error', members: [], error: 'The squadron manager did not answer.' } }, play: toMembers };
/** No machine answers yet, so there is no workspace to pick. */
export const MembersNoMachines: Story = { args: { crew: { ...CREW, offers: [] } }, play: toMembers };
/** Forming refused a machine label the fleet does not have: the error under the member that names it. */
export const MembersLabelRefused: Story = {
  args: {
    crew: {
      ...CREW,
      members: DRAFTS.map((draft) => ({ ...draft, crew: { ...draft.crew, workspace: { kind: 'repositories' as const, main: { repository: 'aeolus-fleet' }, subRepositories: [] } }, parameters: draft.parameters.map((parameter) => ({ ...parameter, value: 'tide tables' })) })),
    },
    error: 'The fleet has no machine label site=home, so nothing was formed',
  },
  play: toMembers,
};
/** A member's files name a main repository at a branch and a sub-repository: the same fields as the crew settings, every member ready (#1769). */
export const MembersSubRepositories: Story = {
  args: {
    crew: {
      ...CREW,
      members: DRAFTS.map((draft) => ({
        ...draft,
        crew: { ...draft.crew, workspace: { kind: 'repositories' as const, main: { repository: 'aeolus-fleet', ...(draft.slot === 'implementer-1' ? { ref: 'next' } : {}) }, subRepositories: draft.slot === 'implementer-1' ? [{ repository: 'hemma' }] : [] }, machineLabels: [{ key: 'os', value: 'macos' }] },
        parameters: draft.parameters.map((parameter) => ({ ...parameter, value: 'tide tables' })),
      })),
    },
  },
  play: async (context) => {
    await toMembers(context);
    const body = within(context.canvasElement.ownerDocument.body);
    await expect(await body.findByTestId('form-squadron-ready')).toHaveTextContent('3 of 3 members ready');
    await expect(body.getByTestId('form-squadron-submit')).toBeEnabled();
  },
};
/** A member's files name a sub-repository no machine offers: its header says so, it is not ready, and Form squadron stays off (#1769). */
export const MembersNotOffered: Story = {
  args: {
    crew: {
      ...CREW,
      members: DRAFTS.map((draft) => ({
        ...draft,
        crew: { ...draft.crew, workspace: { kind: 'repositories' as const, main: { repository: 'aeolus-fleet' }, subRepositories: draft.slot === 'implementer-1' ? [{ repository: 'skills', ref: 'v3' }] : [] }, machineLabels: [{ key: 'os', value: 'macos' }] },
        parameters: draft.parameters.map((parameter) => ({ ...parameter, value: 'tide tables' })),
      })),
    },
  },
  play: async (context) => {
    await toMembers(context);
    const body = within(context.canvasElement.ownerDocument.body);
    await expect(await body.findByTestId('form-squadron-ready')).toHaveTextContent('2 of 3 members ready');
    await expect(body.getByTestId('member-crew-missing')).toHaveTextContent('No machine offers skills.');
    await expect(body.getByTestId('form-squadron-submit')).toBeDisabled();
  },
};
/** Phone: full screen, the footer at the bottom. */
export const MembersPhone: Story = { args: { crew: CREW }, play: toMembers, globals: { viewport: { value: 'mobile1' } } };

/** Catalogue failure reuses the approved line and blocks creation with cached choices too. */
export const GuardReadFailed: Story = {
  args: { crew: { ...CREW, ...MembersAllReady.args?.crew, guardChoices: { names: ['no-push'], floor: ['base'] }, hasGuardReadFailed: true } },
  play: async (context) => {
    await toMembers(context);
    const body = within(context.canvasElement.ownerDocument.body);
    await waitFor(async () => { await expect(body.getByText('Rule sets could not be read. Try again later.')).toBeVisible(); });
    await expect(body.getByTestId('form-squadron-ready')).toHaveTextContent('3 of 3 members ready');
    await expect(body.getByTestId('form-squadron-submit')).toBeDisabled();
  },
};

export const GuardReadPending: Story = {
  args: { crew: { ...CREW, ...MembersAllReady.args?.crew, isGuardReading: true } },
  play: async (context) => {
    await toMembers(context);
    const body = within(context.canvasElement.ownerDocument.body);
    await expect(body.getByTestId('form-squadron-submit')).toBeDisabled();
  },
};


function GuardRecoverySquadron(props: ComponentProps<typeof FormSquadronDialog>) {
  const [hasGuardReadFailed, setHasGuardReadFailed] = useState(true);
  return <><button type="button" data-testid="squadron-guard-recovery" onClick={() => { setHasGuardReadFailed(false); }}>Catalogue read succeeded</button><FormSquadronDialog {...props} crew={{ ...CREW, ...MembersAllReady.args?.crew, hasGuardReadFailed }} /></>;
}

export const GuardReadRecovery: Story = {
  render: (args) => <GuardRecoverySquadron {...args} />,
  play: async (context) => {
    await toMembers(context);
    const body = within(context.canvasElement.ownerDocument.body);
    await expect(body.getByTestId('form-squadron-submit')).toBeDisabled();
    // A catalogue refresh keeps the member form mounted with its settings.
    body.getByTestId('squadron-guard-recovery').click();
    await waitFor(async () => { await expect(body.getByTestId('form-squadron-submit')).toBeEnabled(); });
    await expect(body.getByTestId('form-squadron-ready')).toHaveTextContent('3 of 3 members ready');
    await expect(body.queryByText('Rule sets could not be read. Try again later.')).not.toBeInTheDocument();
  },
};
