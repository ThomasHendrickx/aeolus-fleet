import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { HarnessOffer, WorkspaceChoice } from '../../../../lib/crew-settings-form';
import type { MemberValues } from '../../../../lib/forming-members';
import { MemberCrewSection } from './member-crew-section';

const OFFERS: HarnessOffer[] = [
  {
    harness: 'claude-code',
    repositories: ['tidewater', 'skills', 'tidewater-docs'],
    folders: ['notes'],
    options: [
      { name: 'model', values: ['claude-opus-5-5', 'claude-sonnet-5'], defaultValue: 'claude-opus-5-5' },
      { name: 'effort', values: ['low', 'medium', 'high'] },
    ],
    mcpServers: ['company-graph', 'jira'],
  },
  { harness: 'codex', repositories: ['tidewater'], folders: [], options: [], mcpServers: [] },
];

type Repository = string | { repository: string; ref: string };

/** A main repository with these sub-repositories, each at its default branch or the branch given. */
function repositories(main: Repository, ...subRepositories: readonly Repository[]): WorkspaceChoice {
  const choice = (repository: Repository) => (typeof repository === 'string' ? { repository, ref: '' } : repository);
  return { kind: 'repositories', main: choice(main), subRepositories: subRepositories.map(choice) };
}

const READY: MemberValues = {
  slot: 'implementer-1',
  role: 'implementer',
  template: 'implementer@2',
  harness: 'claude-code',
  workspace: repositories('tidewater'),
  firstPrompt: '',
  options: { model: 'claude-opus-5-5', effort: 'high' },
  machineLabels: [],
  unknownLabels: [],
  mcpServers: ['company-graph'],
  parameters: [],
};

/** The section holding its member, as the forming form does. */
function Section({ member, ...props }: Omit<Parameters<typeof MemberCrewSection>[0], 'onChange'>) {
  const [held, setHeld] = useState(member);
  return <MemberCrewSection {...props} member={held} onChange={setHeld} />;
}

const meta = {
  title: 'Molecules/MemberCrewSection',
  component: Section,
  args: { member: READY, offers: OFFERS, isOpen: false, onOpenChange: fn() },
  decorators: [
    (Story) => (
      <div className="w-full max-w-140">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A member that needs nothing more, folded: its slot, template and Ready. */
export const ReadyFolded: Story = {};
/** The same member open: its main repository at its default branch, no sub-repositories, as the crew settings fields show them (#1769). */
export const ReadyOpen: Story = {
  args: { isOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-workspace')).toHaveTextContent('tidewater · main repository');
    await expect(canvas.getByTestId('crew-settings-branch')).toHaveAttribute('placeholder', 'Default branch');
    await expect(canvas.getByTestId('crew-settings-sub-repositories')).toHaveTextContent('None');
    await expect(canvas.getByTestId('crew-settings-sub-repositories')).toHaveTextContent('for implementer-1 to work in');
  },
};
/** Sub-repositories from its files, a branch on some: each a row with its own Branch and × (#1769). */
export const SubRepositories: Story = {
  args: { isOpen: true, member: { ...READY, workspace: repositories({ repository: 'tidewater', ref: 'next' }, 'skills', { repository: 'tidewater-docs', ref: 'v3' }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-branch')).toHaveValue('next');
    await expect(canvas.getAllByTestId('crew-settings-sub-repository')).toHaveLength(2);
    await expect(canvas.getByRole('textbox', { name: 'Branch of tidewater-docs' })).toHaveValue('v3');
    await expect(canvas.getByRole('button', { name: 'Remove skills' })).toBeVisible();
    await expect(canvas.getByTestId('member-crew-ready')).toBeVisible();
  },
};
/** Add sub-repository offers what the machines offer, less the main repository; the added one gets its row (#1769). */
export const AddsASubRepository: Story = {
  args: { isOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('crew-settings-sub-repositories-add'));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'skills' }));
    await expect(canvas.getAllByTestId('crew-settings-sub-repository')[0]).toHaveTextContent('skills');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Branch of skills' }), 'v3');
    await expect(canvas.getByRole('textbox', { name: 'Branch of skills' })).toHaveValue('v3');
  },
};
/** Its files name a repository no machine offers: its row says so, and the header names it where Needs goes, so the member is not ready (#1769). */
export const NotOffered: Story = {
  args: { isOpen: true, member: { ...READY, workspace: repositories('tidewater', 'harbour') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-sub-repository-row')).toHaveTextContent('No machine offers harbour. Remove it, or join a machine that has it.');
    await expect(canvas.getByTestId('member-crew-missing')).toHaveTextContent('No machine offers harbour.');
    await expect(canvas.queryByTestId('member-crew-ready')).toBeNull();
  },
};
/** Its main repository no machine offers: Workspace says so (#1769). */
export const MainNotOffered: Story = {
  args: { isOpen: true, member: { ...READY, workspace: repositories('harbour') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-workspace')).toHaveTextContent('harbour · main repository');
    await expect(canvas.getByText('No machine offers harbour. Pick another workspace, or join a machine that has it.')).toBeVisible();
    await expect(canvas.getByTestId('member-crew-missing')).toHaveTextContent('No machine offers harbour.');
  },
};
/** The main repository among the sub-repositories: shown on its row, never fixed, and the member is not ready (#1769). */
export const Duplicate: Story = {
  args: { isOpen: true, member: { ...READY, workspace: repositories('tidewater', 'skills', 'tidewater') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('crew-settings-sub-repository-row')[1]).toHaveTextContent('tidewater is the main repository. Remove it here.');
    await expect(canvas.getByTestId('member-crew-missing')).toHaveTextContent('A repository is named twice.');
  },
};
/** A folder: no Branch and no sub-repositories (#1769). */
export const Folder: Story = {
  args: { isOpen: true, member: { ...READY, workspace: { kind: 'folder', name: 'notes' } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-workspace')).toHaveTextContent('notes · folder, as it is');
    await expect(canvas.queryByTestId('crew-settings-branch')).toBeNull();
    await expect(canvas.queryByTestId('crew-settings-sub-repositories')).toBeNull();
  },
};
/** No workspace yet and a parameter its role left empty: both named in its header. */
export const Needs: Story = {
  args: { isOpen: true, member: { ...READY, workspace: undefined, parameters: [{ name: 'area', description: 'The part the features touch', value: '' }] } },
};
/** The harness left to the trierarch, with options its files give that no harness offers here. */
export const TrierarchDefault: Story = { args: { isOpen: true, member: { ...READY, harness: '', options: { model: 'gpt-6-sol', effort: 'low' } } } };
/** Forming refused it: why, under its header. */
export const Refused: Story = { args: { error: 'The fleet has no machine label site=home, so nothing was formed', member: { ...READY, unknownLabels: ['site=home'] } } };
/** While the squadron forms: every field waits, and no × shows (#1769). */
export const Disabled: Story = {
  args: { isOpen: true, isDisabled: true, member: { ...READY, workspace: repositories('tidewater', 'skills') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Branch of skills' })).toBeDisabled();
    await expect(canvas.queryByRole('button', { name: 'Remove skills' })).toBeNull();
    await expect(canvas.getByTestId('crew-settings-branch')).toBeDisabled();
  },
};
