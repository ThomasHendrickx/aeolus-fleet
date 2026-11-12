import { FIRST_PROMPT_MAX_BYTES } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { defaultValues, type CrewSettingsValues, type HarnessOffer, type WorkspaceChoice } from '../../lib/crew-settings-form';
import { CrewSettingsFields } from './crew-settings-fields';

const OFFERS: HarnessOffer[] = [
  {
    harness: 'claude-code',
    repositories: ['aeolus-fleet', 'aeolus-fleet-trierarch', 'skills', 'hemma'],
    folders: ['notes'],
    options: [{ name: 'model', values: ['claude-opus-5-5', 'claude-sonnet-5'], defaultValue: 'claude-opus-5-5' }],
    mcpServers: ['company-graph', 'jira'],
  },
  { harness: 'codex', repositories: ['aeolus-fleet'], folders: [], options: [], mcpServers: [] },
];

type Repository = string | { repository: string; ref: string };

/** A repository at its default branch, or at the branch given. */
function choice(repository: Repository) {
  return typeof repository === 'string' ? { repository, ref: '' } : repository;
}

/** A main repository with these sub-repositories. */
function repositories(main: Repository, ...subRepositories: readonly Repository[]): WorkspaceChoice {
  return { kind: 'repositories', main: choice(main), subRepositories: subRepositories.map(choice) };
}

/** The fields, holding their own values, as a form does. */
function Fields({ workspace, ...props }: { workspace?: WorkspaceChoice; squadrons?: readonly string[]; refusal?: { field: string; reason: string }; isDisabled?: boolean }) {
  const [values, setValues] = useState<CrewSettingsValues>(() => ({ ...defaultValues(OFFERS), ...(workspace === undefined ? {} : { workspace }) }));
  return <CrewSettingsFields shipName="triage-bot" offers={OFFERS} values={values} onChange={setValues} firstPromptMaxBytes={FIRST_PROMPT_MAX_BYTES} {...props} />;
}

const meta = {
  title: 'Molecules/CrewSettingsFields',
  component: Fields,
  decorators: [
    (Story) => (
      <div className="max-w-120">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Fields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};
export const WithSquadrons: Story = { args: { squadrons: ['hemma-feature-63p5sx'] } };

/** A new request: the first repository as main, at its default branch, none added (board 1 and 9). */
export const NoSubRepositories: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-workspace')).toHaveTextContent('aeolus-fleet · main repository');
    await expect(canvas.getByTestId('crew-settings-branch')).toHaveAttribute('placeholder', 'Default branch');
    await expect(canvas.getByTestId('crew-settings-sub-repositories')).toHaveTextContent('None');
    await expect(canvas.getByTestId('crew-settings-sub-repositories-add')).toHaveTextContent('Add sub-repository');
    await expect(canvas.getByTestId('crew-settings-sub-repositories')).toHaveTextContent('Each is a new git worktree beside the main repository, for triage-bot to work in.');
  },
};

/** One sub-repository: its name in mono, its own Branch, and × (board 2). */
export const OneSubRepository: Story = {
  args: { workspace: repositories('aeolus-fleet', 'skills') },
  play: async ({ canvasElement }) => {
    const [row] = within(canvasElement).getAllByTestId('crew-settings-sub-repository-row');
    await expect(row).toHaveTextContent('skills');
    await expect(within(row ?? canvasElement).getByRole('textbox', { name: 'Branch of skills' })).toHaveAttribute('placeholder', 'Default branch');
    await expect(within(row ?? canvasElement).getByRole('button', { name: 'Remove skills' })).toBeVisible();
  },
};

/** Several sub-repositories, branches on some (board 3). */
export const SeveralSubRepositories: Story = {
  args: { workspace: repositories({ repository: 'aeolus-fleet', ref: 'design/ship-folder' }, { repository: 'aeolus-fleet-trierarch', ref: 'release/0.9' }, 'skills', 'hemma') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-branch')).toHaveValue('design/ship-folder');
    await expect(canvas.getAllByTestId('crew-settings-sub-repository').map((row) => row.textContent)).toEqual(['aeolus-fleet-trierarch', 'skills', 'hemma']);
    await expect(canvas.getByRole('textbox', { name: 'Branch of aeolus-fleet-trierarch' })).toHaveValue('release/0.9');
  },
};

/** Add sub-repository offers what the machines offer, less the main repository and those added; picking one adds its row (board 4). */
export const AddsASubRepository: Story = {
  args: { workspace: repositories('aeolus-fleet', 'skills') },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByTestId('crew-settings-sub-repositories-add'));
    await expect((await page.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['aeolus-fleet-trierarch', 'hemma']);
    await userEvent.click(page.getByRole('menuitem', { name: 'hemma' }));
    await expect(page.getAllByTestId('crew-settings-sub-repository').map((row) => row.textContent)).toEqual(['skills', 'hemma']);
  },
};

/** A branch typed for a sub-repository stays on its row. */
export const SetsASubRepositoryBranch: Story = {
  args: { workspace: repositories('aeolus-fleet', 'skills') },
  play: async ({ canvasElement }) => {
    const branch = within(canvasElement).getByRole('textbox', { name: 'Branch of skills' });
    await userEvent.type(branch, 'v1');
    await expect(branch).toHaveValue('v1');
  },
};

/** × takes a sub-repository out; with none left it says None. */
export const RemovesASubRepository: Story = {
  args: { workspace: repositories('aeolus-fleet', 'skills') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove skills' }));
    await expect(canvas.queryAllByTestId('crew-settings-sub-repository')).toHaveLength(0);
    await expect(canvas.getByTestId('crew-settings-sub-repositories')).toHaveTextContent('None');
  },
};

/** Every offered repository added: Add sub-repository stays, off, and says why on focus, as Add server does (board 5). */
export const EveryOfferedAdded: Story = {
  args: { workspace: repositories('aeolus-fleet', 'aeolus-fleet-trierarch', 'skills', 'hemma') },
  play: async ({ canvasElement }) => {
    const add = within(canvasElement).getByTestId('crew-settings-sub-repositories-add');
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    add.focus();
    await waitFor(async () => {
      await expect(within(canvasElement.ownerDocument.body).getByText('Every offered repository is added.')).toBeVisible();
    });
  },
};

/** A held sub-repository no machine offers: its row says so (board 6). */
export const NotOffered: Story = {
  args: { workspace: repositories('aeolus-fleet', 'skills', 'aeolus-website') },
  play: async ({ canvasElement }) => {
    const [, row] = within(canvasElement).getAllByTestId('crew-settings-sub-repository-row');
    await expect(row).toHaveTextContent('No machine offers aeolus-website. Remove it, or join a machine that has it.');
    // The explanation is tied to the row's controls, so a screen reader hears it with them.
    const explanation = 'No machine offers aeolus-website. Remove it, or join a machine that has it.';
    await expect(within(canvasElement).getByRole('textbox', { name: 'Branch of aeolus-website' })).toHaveAccessibleDescription(explanation);
    await expect(within(canvasElement).getByRole('button', { name: 'Remove aeolus-website' })).toHaveAccessibleDescription(explanation);
  },
};

/** A held main repository no machine offers: Workspace shows it and says so under it. */
export const MainNotOffered: Story = {
  args: { workspace: repositories('aeolus-website') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-workspace')).toHaveTextContent('aeolus-website · main repository');
    await expect(canvas.getByText('No machine offers aeolus-website. Pick another workspace, or join a machine that has it.')).toBeVisible();
  },
};

/** Workspace changed to a repository already a sub-repository: the row says it is the main one, nothing fixed silently (board 7). */
export const Duplicate: Story = {
  args: { workspace: repositories('hemma', 'skills', 'aeolus-fleet') },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByTestId('crew-settings-workspace'));
    await userEvent.click(await page.findByRole('option', { name: 'aeolus-fleet · main repository' }));
    const [, row] = page.getAllByTestId('crew-settings-sub-repository-row');
    await expect(row).toHaveTextContent('aeolus-fleet is the main repository. Remove it here.');
  },
};

/** A folder picked: no Branch, no Sub-repositories, and its hint (board 8). */
export const FolderPicked: Story = {
  args: { workspace: { kind: 'folder', name: 'notes' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-workspace')).toHaveTextContent('notes · folder, as it is');
    await expect(canvas.queryByTestId('crew-settings-branch')).toBeNull();
    await expect(canvas.queryByTestId('crew-settings-sub-repositories')).toBeNull();
    await expect(canvas.getByText('A folder is used as it is, shared by the ships in it, with no sub-repositories.')).toBeVisible();
  },
};

/** Saving: every field off and no × (board 11). */
export const Saving: Story = {
  args: { workspace: repositories({ repository: 'aeolus-fleet', ref: 'design/ship-folder' }, { repository: 'aeolus-fleet-trierarch', ref: 'release/0.9' }, 'skills', 'hemma'), isDisabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('crew-settings-branch')).toBeDisabled();
    await expect(canvas.getByRole('textbox', { name: 'Branch of skills' })).toBeDisabled();
    await expect(canvas.queryByRole('button', { name: 'Remove skills' })).toBeNull();
    await expect(canvas.getByTestId('crew-settings-sub-repositories-add')).toBeDisabled();
  },
};

/** The plugin refused the workspace for a sub-repository: its reason shows under that row, not under Workspace (board 12). */
export const RefusedUnderRow: Story = {
  args: { workspace: repositories('aeolus-fleet', 'skills'), refusal: { field: 'workspace', reason: 'no trierarch offering claude-code has repository skills' } },
  play: async ({ canvasElement }) => {
    const [row] = within(canvasElement).getAllByTestId('crew-settings-sub-repository-row');
    await expect(row).toHaveTextContent('no trierarch offering claude-code has repository skills');
    await expect(within(canvasElement).getAllByText('no trierarch offering claude-code has repository skills')).toHaveLength(1);
    await expect(within(canvasElement).getByRole('textbox', { name: 'Branch of skills' })).toHaveAccessibleDescription('no trierarch offering claude-code has repository skills');
  },
};

/** The plugin refused the main repository: its reason shows under Workspace, as before. */
export const WorkspaceRefused: Story = { args: { refusal: { field: 'workspace', reason: 'no trierarch offering claude-code has repository aeolus-fleet' } } };
