import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { userEvent, within } from 'storybook/test';

import type { MemberDraft } from '../../lib/forming-members';
import { blueprintChoices } from '../../lib/squadrons-view';
import { blueprints, templates } from './squadrons.fixtures';
import { FormSquadronDialog, type FormCrew } from './form-squadron-dialog';
import { MACHINE_CONTEXT, MACHINE_LABELS, OFFERS } from './machines.fixtures';

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
    crew: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'claude-opus-5-5' } },
    parameters: [{ name: 'area', description: 'The part the features touch, such as the tide tables', value: null }],
  },
  {
    slot: 'implementer-1',
    role: 'implementer',
    template: { repository: 'github.com/tidewater-labs/squadron-templates', name: 'implementer', version: 2 },
    crew: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'claude-opus-5-5', effort: 'high' }, machineLabels: [{ key: 'os', value: 'macos' }] },
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
        crew: { ...draft.crew, workspace: { kind: 'worktree' as const, repository: 'aeolus-fleet' }, machineLabels: [{ key: 'os', value: 'macos' }] },
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
      members: DRAFTS.map((draft) => ({ ...draft, crew: { ...draft.crew, workspace: { kind: 'worktree' as const, repository: 'aeolus-fleet' } }, parameters: draft.parameters.map((parameter) => ({ ...parameter, value: 'tide tables' })) })),
    },
    error: 'The fleet has no machine label site=home, so nothing was formed',
  },
  play: toMembers,
};
/** Phone: full screen, the footer at the bottom. */
export const MembersPhone: Story = { args: { crew: CREW }, play: toMembers, globals: { viewport: { value: 'mobile1' } } };
