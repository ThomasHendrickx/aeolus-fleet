import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import type { HarnessOffer } from '../../lib/crew-settings-form';
import type { MemberValues } from '../../lib/forming-members';
import { MemberCrewSection } from './member-crew-section';

const OFFERS: HarnessOffer[] = [
  {
    harness: 'claude-code',
    repositories: ['tidewater'],
    folders: ['notes'],
    options: [
      { name: 'model', values: ['claude-opus-5-5', 'claude-sonnet-5'], defaultValue: 'claude-opus-5-5' },
      { name: 'effort', values: ['low', 'medium', 'high'] },
    ],
  },
  { harness: 'codex', repositories: ['tidewater'], folders: [], options: [] },
];

const WORKSPACES = { 'worktree:tidewater': 'tidewater · new worktree', 'folder:notes': 'notes · folder, as it is' };

const READY: MemberValues = {
  slot: 'implementer-1',
  role: 'implementer',
  template: 'implementer@2',
  harness: 'claude-code',
  workspace: { kind: 'worktree', repository: 'tidewater' },
  firstPrompt: '',
  options: { model: 'claude-opus-5-5', effort: 'high' },
  machineLabels: [],
  unknownLabels: [],
  parameters: [],
};

const meta = {
  title: 'Molecules/MemberCrewSection',
  component: MemberCrewSection,
  args: { member: READY, offers: OFFERS, workspaces: WORKSPACES, isOpen: false, onOpenChange: fn(), onChange: fn() },
  decorators: [
    (Story) => (
      <div className="w-140">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MemberCrewSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A member that needs nothing more, folded: its slot, template and Ready. */
export const ReadyFolded: Story = {};
/** The same member open: every field it starts with from its files. */
export const ReadyOpen: Story = { args: { isOpen: true } };
/** No workspace yet and a parameter its role left empty: both named in its header. */
export const Needs: Story = {
  args: { isOpen: true, member: { ...READY, workspace: undefined, parameters: [{ name: 'area', description: 'The part the features touch', value: '' }] } },
};
/** The harness left to the trierarch, with options its files give that no harness offers here. */
export const TrierarchDefault: Story = { args: { isOpen: true, member: { ...READY, harness: '', options: { model: 'gpt-6-sol', effort: 'low' } } } };
/** Forming refused it: why, under its header. */
export const Refused: Story = { args: { error: 'The fleet has no machine label site=home, so nothing was formed', member: { ...READY, unknownLabels: ['site=home'] } } };
/** While the squadron forms: every field waits. */
export const Disabled: Story = { args: { isOpen: true, isDisabled: true } };
