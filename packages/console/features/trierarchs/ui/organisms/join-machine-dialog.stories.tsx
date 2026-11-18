import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import type { JoinMachineInput } from '../../../../lib/join-machine-input';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { JOINED } from '../../../../lib/fixtures/machines.fixtures';
import { JoinMachineDialog } from './join-machine-dialog';

const meta = {
  title: 'Organisms/JoinMachineDialog',
  component: JoinMachineDialog,
  parameters: { layout: 'fullscreen' },
  args: { takenNames: ['trierarch-mac'], isOpen: true, onOpenChange: () => undefined, isPending: false, onSubmit: fn() },
  decorators: [
    (Story) => (
      <div className="min-h-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JoinMachineDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Name: Story = {};
export const Joining: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'A ship named trierarch-mac exists.' } };
export const Joined: Story = { args: { joined: JOINED } };

async function named() {
  await userEvent.type(await screen.findByTestId('join-machine-name'), 'trierarch-new');
}

async function filled() {
  await named();
  await userEvent.click(screen.getByTestId('join-machine-claude-code-unattended'));
  await userEvent.click(screen.getByTestId('join-machine-codex'));
  await userEvent.click(screen.getByTestId('join-machine-repositories-list'));
  await userEvent.type(screen.getByTestId('join-machine-repository-1'), '~/code/web');
  await userEvent.click(screen.getByTestId('join-machine-add-field'));
  await userEvent.type(screen.getByTestId('join-machine-repository-2'), '~/code/api');
  await userEvent.click(screen.getByTestId('join-machine-add-field'));
  await userEvent.type(screen.getByTestId('join-machine-repository-3'), 'git@github.com:acme/docs.git');
}

export const AfterEmpty: Story = {
  play: async () => {
    // Given the name step opens, when nothing is filled, then the machine asks for both options.
    await expect(await screen.findByTestId('join-machine-repositories-ask')).toBeChecked();
    await expect(screen.getByTestId('join-machine-claude-code')).not.toBeChecked();
    await expect(screen.getByTestId('join-machine-submit')).toBeDisabled();
  },
};
export const AfterNamed: Story = {
  play: async ({ args }) => {
    // Given a free name, when joined with no options, then only the name goes to the plugin.
    await named();
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new' });
  },
};
export const AfterTaken: Story = {
  play: async () => {
    await userEvent.type(await screen.findByTestId('join-machine-name'), 'trierarch-mac');
    await expect(screen.getByTestId('join-machine-submit')).toBeDisabled();
  },
};
export const AfterFilled: Story = {
  play: async ({ args }) => {
    // Given harnesses and separate paths and a git URL, when joined, then the plugin receives the options, not a line.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['claude-code', 'codex'], unattended: ['claude-code'], repositories: { kind: 'list', entries: ['~/code/web', '~/code/api', 'git@github.com:acme/docs.git'] } });
  },
};
export const AfterFieldAdded: Story = {
  play: async ({ args }) => {
    // Given filled rows, when Add field is pressed, then a removable empty row appears and is omitted on join.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-add-field'));
    await expect(screen.getByTestId('join-machine-repository-4')).toHaveValue('');
    await expect(screen.getByTestId('join-machine-repository-4')).toHaveAttribute('placeholder', '~/code/web or git@github.com:acme/docs.git');
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['claude-code', 'codex'], unattended: ['claude-code'], repositories: { kind: 'list', entries: ['~/code/web', '~/code/api', 'git@github.com:acme/docs.git'] } });
  },
};
export const AfterUnattendedTicked: Story = {
  play: async () => {
    // Given Claude Code is off, when its without-asking is ticked, then its harness is ticked too.
    await named();
    await userEvent.click(screen.getByTestId('join-machine-codex-unattended'));
    await expect(screen.getByTestId('join-machine-codex')).toBeChecked();
    await userEvent.click(screen.getByTestId('join-machine-codex'));
    await expect(screen.getByTestId('join-machine-codex-unattended')).not.toBeChecked();
    await userEvent.click(screen.getByTestId('join-machine-claude-code-unattended'));
    await expect(screen.getByTestId('join-machine-claude-code')).toBeChecked();
  },
};
export const AfterHarnessUnticked: Story = {
  play: async ({ args }) => {
    // Given Claude Code runs without asking, when the harness is unticked, then without-asking is unticked too.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-claude-code'));
    await expect(screen.getByTestId('join-machine-claude-code-unattended')).not.toBeChecked();
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['codex'], repositories: { kind: 'list', entries: ['~/code/web', '~/code/api', 'git@github.com:acme/docs.git'] } });
  },
};
export const AfterFolder: Story = {
  play: async ({ args }) => {
    await named();
    await userEvent.click(screen.getByTestId('join-machine-codex'));
    await userEvent.click(screen.getByTestId('join-machine-repositories-folder'));
    await userEvent.type(screen.getByTestId('join-machine-folder'), '~/code');
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['codex'], repositories: { kind: 'folder', path: '~/code' } });
  },
};
export const AfterNoRepositories: Story = {
  play: async ({ args }) => {
    await named();
    await userEvent.click(screen.getByTestId('join-machine-copilot'));
    await userEvent.click(screen.getByTestId('join-machine-repositories-none'));
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: 'trierarch-new', harnesses: ['copilot'], repositories: { kind: 'none' } });
  },
};
export const AfterInvalidList: Story = {
  play: async () => {
    // Given paths in separate fields, when one lacks / or ~ and is no git URL, then its own error blocks joining.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-remove-3'));
    await userEvent.clear(screen.getByTestId('join-machine-repository-2'));
    await userEvent.type(screen.getByTestId('join-machine-repository-2'), 'code/api');
    await expect(screen.getByText('code/api is no path from / or ~, and no git URL.')).toBeVisible();
    await expect(screen.getByTestId('join-machine-repository-2')).toHaveAttribute('aria-invalid', 'true');
    await expect(screen.getByTestId('join-machine-repository-1')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(screen.getByTestId('join-machine-submit')).toBeDisabled();
  },
};

/** A press shows the mutation pending immediately, with the filled form kept and all edits off. */
export const PressShowsPending: Story = {
  render: function Render(args) {
    const [isPending, setIsPending] = useState(false);
    return <JoinMachineDialog {...args} isPending={isPending} onSubmit={() => { setIsPending(true); }} />;
  },
  play: async () => {
    // Given a filled form, when Join machine is pressed, then it shows Joining before any answer.
    await filled();
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    await expect(screen.getByTestId('join-machine-submit')).toHaveTextContent('Joining');
    await expect(screen.getByTestId('join-machine-submit')).toHaveAttribute('aria-busy', 'true');
    await expect(screen.getByTestId('join-machine-name')).toBeDisabled();
    await expect(screen.getByTestId('join-machine-claude-code')).toHaveAttribute('data-disabled');
    await expect(screen.getByTestId('join-machine-repository-1')).toBeDisabled();
    await expect(screen.getByTestId('join-machine-repository-1')).toHaveValue('~/code/web');
    await expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  },
};

/** The unpictured folder edge clarified by orchestrator-1: empty is disabled silently; bad shape names the rule. */
export const InvalidFolder: Story = {
  play: async () => {
    // Given a free name and the folder choice, when empty, then joining is disabled without a new error.
    await named();
    await userEvent.click(screen.getByTestId('join-machine-repositories-folder'));
    await expect(screen.getByTestId('join-machine-submit')).toBeDisabled();
    await expect(screen.getByTestId('join-machine-folder')).not.toHaveAttribute('aria-invalid', 'true');

    // When a nonempty folder is no full path, then the error names how to fix it and joining remains disabled.
    await userEvent.type(screen.getByTestId('join-machine-folder'), 'code/api');
    await expect(screen.getByText('code/api is not a full path: start it with / or ~.')).toBeVisible();
    await expect(screen.getByTestId('join-machine-submit')).toBeDisabled();
  },
};

const COMPLETE_INPUT: JoinMachineInput = { name: 'trierarch-new', harnesses: ['claude-code', 'codex'], unattended: ['claude-code'], repositories: { kind: 'list', entries: ['~/code/web', '~/code/api', 'git@github.com:acme/docs.git'] } };
const JOINED_ASKS = { ...JOINED, setupLine: JOINED.setupLine.replace(' --secret', ' --plugin-ship-id shp_01j9k2t4qzr3a9w6m2v5n7plgn --secret') };
const JOINED_COMPLETE = { ...JOINED_ASKS, setupLine: JOINED_ASKS.setupLine.replace(' --secret-stdin', " --harnesses claude-code,codex --unattended claude-code --repositories '~/code/web,~/code/api,git@github.com:acme/docs.git' --secret-stdin") };
const STDIN_ASKS = "bash <(curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh) --fleet-url https://fleet.example.com --ship-id shp_01j9k2t4qzr3a9w6m2v5n7trnw --plugin-ship-id shp_01j9k2t4qzr3a9w6m2v5n7plgn --secret-stdin <<< 'aeolus_sk_v1_example'";
const STDIN_COMPLETE = "bash <(curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh) --fleet-url https://fleet.example.com --ship-id shp_01j9k2t4qzr3a9w6m2v5n7trnw --plugin-ship-id shp_01j9k2t4qzr3a9w6m2v5n7plgn --harnesses claude-code,codex --unattended claude-code --repositories '~/code/web,~/code/api,git@github.com:acme/docs.git' --secret-stdin <<< 'aeolus_sk_v1_example'";

const writeClipboard = fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);

function clipboardWorks() {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  writeClipboard.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: writeClipboard } });
  return () => {
    if (clipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard');
    else Object.defineProperty(navigator, 'clipboard', clipboard);
  };
}

const COMPLETE_DESCRIPTION = 'Run this line in a terminal on the machine. It installs the trierarch and the aeolus-fleet plugin for Claude Code and Codex, adds 3 repositories, and starts the trierarch. It asks nothing. It ends with a report of how it went.';
const ASKS_DESCRIPTION = 'Run this line in a terminal on the machine. It installs the trierarch, the aeolus-fleet plugin for each harness you pick, and starts the trierarch. It asks on the machine for the harnesses and the repositories. It ends with a report of how it went.';

export const AfterJoinedComplete: Story = {
  args: { joined: JOINED_COMPLETE, joinedInput: COMPLETE_INPUT },
  beforeEach: clipboardWorks,
  play: async () => {
    // Given all join options were filled.
    const line = await screen.findByTestId('join-machine-setup-line');
    // When the plugin answers with its setup line.
    await expect(line.textContent).toBe(STDIN_COMPLETE);
    await userEvent.click(screen.getByTestId('join-machine-setup-line-copy'));
    await expect(writeClipboard).toHaveBeenCalledWith(STDIN_COMPLETE);
    await expect(screen.getByTestId('join-machine-setup-line-copy')).toHaveTextContent('Copied');
    // Then setup is explained before the line, even when options came from the console.
    await waitFor(async () => { await expect(screen.getByText('This installs the trierarch, which runs agent sessions on this computer. Setup explains permissions, workspaces, limits and starting the background service. If your line uses npm, npm may first ask to download the trierarch package; that confirmation installs the package and does not answer the setup choices.')).toBeVisible(); });
    await waitFor(async () => { await expect(screen.getByText(COMPLETE_DESCRIPTION)).toBeVisible(); });
    await expect(screen.queryByTestId('join-machine-prompt')).not.toBeInTheDocument();
    await expect(screen.queryByTestId('join-machine-crew-line-claude-code')).not.toBeInTheDocument();
    await expect(screen.getAllByRole('button', { name: /Copy/ })).toHaveLength(1);
  },
};

export const AfterJoinedAsks: Story = {
  args: { joined: JOINED_ASKS },
  beforeEach: clipboardWorks,
  play: async () => {
    // Given only the name was filled.
    const line = await screen.findByTestId('join-machine-setup-line');
    // When the plugin answers.
    await expect(line.textContent).toBe(STDIN_ASKS);
    await userEvent.click(screen.getByTestId('join-machine-setup-line-copy'));
    await expect(writeClipboard).toHaveBeenCalledWith(STDIN_ASKS);
    await expect(screen.getByTestId('join-machine-setup-line-copy')).toHaveTextContent('Copied');
    // Then the approved introduction explains the purpose, choices and npm confirmation before running setup.
    await waitFor(async () => { await expect(screen.getByText('This installs the trierarch, which runs agent sessions on this computer. Setup explains permissions, workspaces, limits and starting the background service. If your line uses npm, npm may first ask to download the trierarch package; that confirmation installs the package and does not answer the setup choices.')).toBeVisible(); });
    await waitFor(async () => { await expect(screen.getByText(ASKS_DESCRIPTION)).toBeVisible(); });
    await expect(screen.queryByTestId('join-machine-prompt')).not.toBeInTheDocument();
  },
};

export const AfterJoinedCopyFailed: Story = {
  args: { joined: JOINED_ASKS },
  beforeEach: () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Clipboard unavailable')) } });
    return () => {
      if (clipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard');
      else Object.defineProperty(navigator, 'clipboard', clipboard);
    };
  },
  play: async () => {
    // Given the clipboard refuses access.
    const copy = await screen.findByTestId('join-machine-setup-line-copy');
    // When Copy is pressed.
    await userEvent.click(copy);
    // Then the person is told to select the unchanged line and copy it by hand.
    await waitFor(async () => { await expect(screen.getByText('Could not copy: select the text and copy it by hand.')).toBeVisible(); });
    await expect(screen.getByTestId('join-machine-setup-line').textContent).toBe(STDIN_ASKS);
  },
};

export const AfterJoining: Story = { ...PressShowsPending };

export const AfterFailed: Story = {
  render: function Render(args) {
    const [error, setError] = useState<string>();
    return <JoinMachineDialog {...args} error={error} onSubmit={() => { setError('The trierarch plugin did not answer.'); }} />;
  },
  play: async () => {
    // Given a filled form.
    await filled();
    // When the plugin refuses or does not answer.
    await userEvent.click(screen.getByTestId('join-machine-submit'));
    // Then the reason is shown, nothing changed, and the input stays editable.
    await expect(screen.getByText('The trierarch plugin did not answer. Nothing changed.')).toBeVisible();
    await expect(screen.getByTestId('join-machine-repository-1')).toHaveValue('~/code/web');
    await expect(screen.getByTestId('join-machine-repository-3')).toHaveValue('git@github.com:acme/docs.git');
    await expect(screen.getByTestId('join-machine-name')).toHaveValue('trierarch-new');
    await expect(screen.getByTestId('join-machine-submit')).toBeEnabled();
    await expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  },
};
